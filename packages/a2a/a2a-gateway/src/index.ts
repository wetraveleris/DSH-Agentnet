/** Small A2A Protocol v1.0 gateway used for local and public integration tests. @module @deepseek-ai/dsh-a2a-gateway */

import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import type { Server } from 'node:http'
import { join, resolve } from 'node:path'
import express, { type Express, type Request, type Response } from 'express'
import {
  AgentEvent,
  DefaultRequestHandler,
  InMemoryTaskStore,
  type AgentExecutor,
} from '@a2a-js/sdk/server'
import { agentCardHandler, restHandler, UserBuilder } from '@a2a-js/sdk/server/express'
import {
  A2A_DIRECT_UPLOAD_EXTENSION,
} from '@deepseek-ai/dsh-a2a'
import { Role, TaskState, type AgentCard, type Artifact, type Message, type Task, type TaskStatusUpdateEvent } from '@a2a-js/sdk'

/** Gateway configuration. */
export interface GatewayConfig {
  /** Stable configured identity returned in direct-upload tickets. */
  readonly agentId?: string
  /** Bind address. */
  readonly host?: string
  /** Bind port. */
  readonly port?: number
  /** Public base URL used in the Agent Card and upload tickets. */
  readonly publicUrl: string
  /** Private owner-only directory for temporary uploads. */
  readonly uploadRoot?: string
  /** Maximum size of one upload. */
  readonly maxUploadBytes?: number
  /** Upload ticket lifetime in milliseconds. */
  readonly uploadTtlMs?: number
  /** Human-visible Agent name. */
  readonly name?: string
  /** Human-visible Agent description. */
  readonly description?: string
  /** Public capabilities declared in the Agent Card. */
  readonly skills?: readonly GatewaySkill[]
  /** Task executor that runs after uploaded files have passed integrity checks. */
  readonly executor?: GatewayTaskExecutor
}

/** One public capability declared by an A2A Gateway. */
export interface GatewaySkill {
  /** Stable capability identifier used during Registry discovery. */
  readonly id: string
  /** Human-visible capability name. */
  readonly name: string
  /** What work this capability performs. */
  readonly description: string
  /** Optional searchable labels. */
  readonly tags?: readonly string[]
  /** Optional request examples. */
  readonly examples?: readonly string[]
  /** Accepted A2A media types. */
  readonly inputModes?: readonly string[]
  /** Produced A2A media types. */
  readonly outputModes?: readonly string[]
}

/** A verified file available only to the local Gateway executor. */
export interface GatewayAttachment {
  /** Opaque upload identifier referenced by the A2A message. */
  readonly id: string
  /** Caller-provided display name. */
  readonly name: string
  /** Declared media type. */
  readonly mediaType: string
  /** Verified byte length. */
  readonly byteLength: number
  /** Verified SHA-256 digest. */
  readonly sha256: string
  /** Owner-only local file path. This field never appears in an A2A response. */
  readonly path: string
}

/** Local execution input derived from one remote A2A message. */
export interface GatewayTaskInput {
  /** Remote task identity. */
  readonly taskId: string
  /** Remote context identity. */
  readonly contextId: string
  /** Plain-text instruction from the A2A message. */
  readonly instruction: string
  /** Verified local files attached to this task. */
  readonly attachments: readonly GatewayAttachment[]
}

/** Execute one accepted task in the node's own trust domain. */
export type GatewayTaskExecutor = (input: GatewayTaskInput, signal: AbortSignal) => Promise<string>

const DEFAULT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024
const DEFAULT_UPLOAD_TTL_MS = 10 * 60 * 1000

interface UploadRecord {
  readonly id: string
  readonly token: string
  readonly root: string
  readonly name: string
  readonly mediaType: string
  readonly byteLength: number
  readonly sha256: string
  readonly expiresAt: number
  uploaded: boolean
}

function textOf(message: Message): string {
  return message.parts
    .filter(part => part.content?.$case === 'text')
    .map(part => part.content?.$case === 'text' ? part.content.value : '')
    .join('\n')
}

function card(config: Required<Pick<GatewayConfig, 'publicUrl' | 'name' | 'description' | 'skills'>>): AgentCard {
  return {
    name: config.name,
    description: config.description,
    supportedInterfaces: [{ url: `${config.publicUrl}/a2a`, protocolBinding: 'HTTP+JSON', protocolVersion: '1.0', tenant: '' }],
    provider: { organization: 'DeepSeek Harness experiment', url: config.publicUrl },
    version: '0.1.0',
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extensions: [{ uri: A2A_DIRECT_UPLOAD_EXTENSION, description: 'Short-lived one-use direct file uploads into this Agent sandbox.', required: false, params: undefined }],
      extendedAgentCard: false,
    },
    securitySchemes: {},
    securityRequirements: [],
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['text/plain', 'application/json'],
    skills: config.skills.map(skill => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      tags: [...(skill.tags ?? [])],
      examples: [...(skill.examples ?? [])],
      inputModes: [...(skill.inputModes ?? ['text/plain'])],
      outputModes: [...(skill.outputModes ?? ['text/plain'])],
      securityRequirements: [],
    })),
    signatures: [],
    documentationUrl: config.publicUrl,
    iconUrl: undefined,
  }
}

function status(taskId: string, contextId: string, state: TaskState, message: Message | undefined): TaskStatusUpdateEvent {
  return { taskId, contextId, status: { state, message, timestamp: new Date().toISOString() }, metadata: undefined }
}

function artifact(text: string): Artifact {
  return {
    artifactId: randomUUID(),
    name: 'result.txt',
    description: 'Gateway integration result',
    parts: [{ content: { $case: 'text', value: text }, filename: 'result.txt', mediaType: 'text/plain', metadata: undefined }],
    metadata: undefined,
    extensions: [],
  }
}

function defaultTaskExecutor(input: GatewayTaskInput): Promise<string> {
  return Promise.resolve(`Received instruction: ${input.instruction}${input.attachments.length === 0 ? '' : `\nAttachments: ${input.attachments.map(item => `${item.name} (${item.byteLength} bytes, ${item.sha256})`).join(', ')}`}`)
}

function executor(run: GatewayTaskExecutor, uploads: ReadonlyMap<string, UploadRecord>): AgentExecutor {
  return {
    async execute(request, eventBus) {
      const initial: Task = {
        id: request.taskId,
        contextId: request.contextId,
        status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: new Date().toISOString() },
        artifacts: [], history: [request.userMessage], metadata: {},
      }
      eventBus.publish(AgentEvent.task(initial))
      const attachmentData = request.userMessage.metadata?.[A2A_DIRECT_UPLOAD_EXTENSION] as {
        attachments?: readonly { attachmentId?: string; name?: string; byteLength?: number; sha256?: string }[]
      } | undefined
      const references = attachmentData?.attachments ?? []
      const attachments: GatewayAttachment[] = []
      for (const reference of references) {
        const attachmentId = reference.attachmentId
        const record = attachmentId === undefined ? undefined : uploads.get(attachmentId)
        if (record === undefined || !record.uploaded) {
          const failure: Message = {
            messageId: randomUUID(), contextId: request.contextId, taskId: request.taskId, role: Role.ROLE_AGENT,
            parts: [{ content: { $case: 'text', value: 'The task references an unavailable uploaded attachment.' }, filename: '', mediaType: 'text/plain', metadata: undefined }], metadata: undefined, extensions: [], referenceTaskIds: [],
          }
          eventBus.publish(AgentEvent.statusUpdate(status(request.taskId, request.contextId, TaskState.TASK_STATE_FAILED, failure)))
          eventBus.finished()
          return
        }
        attachments.push({
          id: record.id,
          name: record.name,
          mediaType: record.mediaType,
          byteLength: record.byteLength,
          sha256: record.sha256,
          path: join(record.root, 'content'),
        })
      }
      let response: string
      try {
        response = await run({
          taskId: request.taskId,
          contextId: request.contextId,
          instruction: textOf(request.userMessage),
          attachments,
        }, AbortSignal.timeout(10 * 60 * 1000))
      } catch (error: unknown) {
        const failure: Message = {
          messageId: randomUUID(), contextId: request.contextId, taskId: request.taskId, role: Role.ROLE_AGENT,
          parts: [{ content: { $case: 'text', value: `Task execution failed: ${error instanceof Error ? error.message : String(error)}` }, filename: '', mediaType: 'text/plain', metadata: undefined }], metadata: undefined, extensions: [], referenceTaskIds: [],
        }
        eventBus.publish(AgentEvent.statusUpdate(status(request.taskId, request.contextId, TaskState.TASK_STATE_FAILED, failure)))
        eventBus.finished()
        return
      }
      const agentMessage: Message = {
        messageId: randomUUID(), contextId: request.contextId, taskId: request.taskId, role: Role.ROLE_AGENT,
        parts: [{ content: { $case: 'text', value: response }, filename: '', mediaType: 'text/plain', metadata: undefined }], metadata: undefined, extensions: [], referenceTaskIds: [],
      }
      eventBus.publish(AgentEvent.artifactUpdate({
        taskId: request.taskId,
        contextId: request.contextId,
        artifact: artifact(response),
        append: false,
        lastChunk: true,
        metadata: undefined,
      }))
      eventBus.publish(AgentEvent.statusUpdate(status(request.taskId, request.contextId, TaskState.TASK_STATE_COMPLETED, agentMessage)))
      eventBus.finished()
    },
    cancelTask(taskId, eventBus) {
      eventBus.publish(AgentEvent.statusUpdate(status(taskId, '', TaskState.TASK_STATE_CANCELED, undefined)))
      eventBus.finished()
      return Promise.resolve()
    },
  }
}

/** Returned resources owned by one gateway instance. */
export interface GatewayHandle {
  readonly app: Express
  readonly config: Required<Pick<GatewayConfig,
    'agentId' | 'host' | 'port' | 'publicUrl' | 'uploadRoot' | 'maxUploadBytes' | 'uploadTtlMs' | 'name' | 'description'>>
  readonly close: () => Promise<void>
}

/** Create the Express application without binding a port.
 * @param config - gateway bind, public URL, and temporary upload settings.
 * @returns an unbound application and its cleanup handle.
 */
export async function createGateway(config: GatewayConfig): Promise<GatewayHandle> {
  const parentUploadRoot = resolve(config.uploadRoot ?? './.dsh-a2a-uploads')
  const base = {
    agentId: config.agentId ?? 'gateway',
    host: config.host ?? '127.0.0.1', port: config.port ?? 18090,
    publicUrl: config.publicUrl.replace(/\/$/, ''),
    maxUploadBytes: config.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES,
    uploadTtlMs: config.uploadTtlMs ?? DEFAULT_UPLOAD_TTL_MS,
    name: config.name ?? 'DSH A2A Experiment Agent',
    description: config.description ?? 'A2A gateway for DeepSeek Harness integration tests',
    skills: config.skills ?? [{
      id: 'echo-and-inspect',
      name: 'Echo and inspect',
      description: 'Accepts an instruction and reports uploaded attachment metadata.',
      tags: ['a2a', 'files'],
      examples: ['Inspect the uploaded project'],
      inputModes: ['text/plain'],
      outputModes: ['text/plain'],
    }],
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(base.agentId)) throw new Error('a2a-gateway: agentId must contain 1-64 ASCII letters, digits, underscores, or hyphens')
  if (!Number.isSafeInteger(base.port) || base.port < 0 || base.port > 65535) throw new Error('a2a-gateway: port must be a valid TCP port or 0 for an ephemeral listener')
  if (!Number.isSafeInteger(base.maxUploadBytes) || base.maxUploadBytes < 1) throw new Error('a2a-gateway: maxUploadBytes must be positive')
  if (!Number.isSafeInteger(base.uploadTtlMs) || base.uploadTtlMs < 1) throw new Error('a2a-gateway: uploadTtlMs must be positive')
  const publicUrl = new URL(base.publicUrl)
  if (publicUrl.protocol !== 'http:' && publicUrl.protocol !== 'https:') throw new Error('a2a-gateway: publicUrl must use HTTP or HTTPS')
  await mkdir(parentUploadRoot, { recursive: true, mode: 0o700 })
  const instanceUploadRoot = await mkdtemp(join(parentUploadRoot, 'gateway-'))
  await chmod(instanceUploadRoot, 0o700)
  const resolved = { ...base, uploadRoot: instanceUploadRoot }
  const uploads = new Map<string, UploadRecord>()
  const app = express()
  app.disable('x-powered-by')
  app.use((req, res, next) => { res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', 'content-type,x-dsh-a2a-upload-token,a2a-version'); res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS'); if (req.method === 'OPTIONS') { res.status(204).end(); return } next() })
  const cardValue = card(resolved)
  const requestHandler = new DefaultRequestHandler(
    cardValue,
    new InMemoryTaskStore(),
    executor(config.executor ?? defaultTaskExecutor, uploads),
  )
  app.use('/.well-known/agent-card.json', agentCardHandler({ agentCardProvider: requestHandler }))
  app.use('/a2a', express.json({ limit: '1mb' }), restHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }))
  app.post('/dsh/uploads', express.json({ limit: '32kb' }), async (req: Request, res: Response) => {
    const body = req.body as Partial<{ name: string; mediaType: string; byteLength: number; sha256: string }>
    if (typeof body.name !== 'string' || typeof body.mediaType !== 'string' || typeof body.byteLength !== 'number' || !Number.isSafeInteger(body.byteLength) || body.byteLength < 0 || body.byteLength > resolved.maxUploadBytes || typeof body.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(body.sha256)) { res.status(400).json({ error: 'invalid upload metadata' }); return }
    const byteLength = body.byteLength
    const id = randomUUID()
    const token = randomUUID()
    const expiresAt = Date.now() + resolved.uploadTtlMs
    const root = join(resolved.uploadRoot, id)
    await mkdir(root, { recursive: true, mode: 0o700 })
    uploads.set(id, {
      id, token, root, name: body.name, mediaType: body.mediaType, byteLength, sha256: body.sha256, expiresAt, uploaded: false,
    })
    res.status(201).json({
      agentId: resolved.agentId,
      attachmentId: id,
      uploadUrl: `${resolved.publicUrl}/dsh/uploads/${id}`,
      token,
      expiresAt,
      name: body.name,
      mediaType: body.mediaType,
      byteLength,
      sha256: body.sha256,
    })
  })
  app.put('/dsh/uploads/:id', express.raw({ type: '*/*', limit: resolved.maxUploadBytes }), async (req: Request, res: Response) => {
    const id = typeof req.params.id === 'string' ? req.params.id : undefined
    const record = id === undefined ? undefined : uploads.get(id); const supplied = req.header('x-dsh-a2a-upload-token') ?? ''
    if (record === undefined || record.uploaded || record.expiresAt <= Date.now() || supplied.length !== record.token.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(record.token))) { res.status(401).json({ error: 'invalid or expired upload ticket' }); return }
    const bytes = req.body as Buffer
    if (bytes.byteLength !== record.byteLength || createHash('sha256').update(bytes).digest('hex') !== record.sha256) { res.status(400).json({ error: 'upload integrity check failed' }); return }
    await writeFile(join(record.root, 'content'), bytes, { mode: 0o600 }); record.uploaded = true; res.status(204).end()
  })
  const cleanup = setInterval(() => {
    const now = Date.now()
    for (const [id, record] of uploads) {
      if (record.expiresAt > now) continue
      uploads.delete(id)
      void rm(record.root, { recursive: true, force: true })
    }
  }, Math.min(resolved.uploadTtlMs, 60_000))
  return {
    app,
    config: resolved,
    close: async () => {
      clearInterval(cleanup)
      await rm(resolved.uploadRoot, { recursive: true, force: true })
    },
  }
}

/** Bind the gateway and return its HTTP server.
 * @param config - gateway bind, public URL, and temporary upload settings.
 * @returns the running HTTP server and its cleanup handle.
 */
export async function startGateway(config: GatewayConfig): Promise<GatewayHandle & { readonly server: Server }> {
  const gateway = await createGateway(config)
  const server = await new Promise<Server>((resolveServer, reject) => {
    const value = gateway.app.listen(gateway.config.port, gateway.config.host, () => { resolveServer(value) })
    value.once('error', reject)
  })
  return {
    ...gateway,
    server,
    close: async () => {
      await new Promise<void>((resolveClose, reject) => {
        server.close((error) => { if (error === undefined) resolveClose(); else reject(error) })
      })
      await gateway.close()
    },
  }
}

export const name = 'a2a-gateway'
