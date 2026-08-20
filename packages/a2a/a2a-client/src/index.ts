/** Official A2A SDK client provider with DSH's direct-upload extension. @module @deepseek-ai/dsh-a2a-client */

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  A2A_DIRECT_UPLOAD_EXTENSION,
  type A2AAgentCardView,
  type A2AAgentId,
  type A2AAgentView,
  type A2AGetTaskRequest,
  type A2AJsonValue,
  type A2APrepareUploadRequest,
  type A2ASendRequest,
  type A2AService,
  type A2ATaskView,
  type A2AUploadTicket,
} from '@deepseek-ai/dsh-a2a'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import {
  ClientFactory,
  DefaultAgentCardResolver,
  JsonRpcTransportFactory,
  RestTransportFactory,
} from '@a2a-js/sdk/client'
import { Role, taskStateToJSON, type AgentCard, type Message, type Part, type Task } from '@a2a-js/sdk'

/** A configured remote Agent endpoint. */
export interface A2AConfiguredAgent {
  /** HTTPS base URL that serves the peer's standard Agent Card. */
  readonly endpoint: string
  /** Optional explicit standard Agent Card URL returned by the Registry. */
  readonly cardUrl?: string
  /** Optional HTTPS endpoint that reserves direct-upload tickets. */
  readonly uploadUrl?: string
  /** Optional transport headers for a trusted private deployment. */
  readonly headers?: Readonly<Record<string, string>>
}

/** Provider configuration. */
export interface Config {
  /** Named remote Agents available to tools and UI. */
  readonly agents: Readonly<Record<string, A2AConfiguredAgent>>
  /** Optional public Registry URL used for capability-based peer discovery. */
  readonly registryUrl?: string
  /** Bearer token for a private Registry discovery endpoint. */
  readonly registryToken?: string
  /** Credential reference used when registryToken is not supplied. */
  readonly registryTokenRef?: string
  /** Maximum direct upload size accepted by the local client. */
  readonly maxUploadBytes?: number
  /** Per-request timeout in milliseconds. */
  readonly requestTimeoutMs?: number
  /** Development-only opt-in for plain HTTP endpoints. */
  readonly allowInsecureHttp?: boolean
  /** Shared access token for peers published through one private Relay. */
  readonly relayAccessToken?: string
  /** Credential reference used when relayAccessToken is not supplied. */
  readonly relayAccessTokenRef?: string
}

const DEFAULT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000
const SHA256_PATTERN = /^[0-9a-f]{64}$/

const AgentConfig = z.object({
  endpoint: z.string().required(),
  cardUrl: z.string(),
  uploadUrl: z.string(),
  headers: z.dict(z.string()),
})

export const Config: z<Config> = z.object({
  agents: z.dict(AgentConfig).default({}),
  registryUrl: z.string(),
  registryToken: z.string(),
  registryTokenRef: z.string(),
  maxUploadBytes: z.number().step(1).min(1).default(DEFAULT_MAX_UPLOAD_BYTES),
  requestTimeoutMs: z.number().step(1).min(1).default(DEFAULT_REQUEST_TIMEOUT_MS),
  allowInsecureHttp: z.boolean().default(false),
  relayAccessToken: z.string(),
  relayAccessTokenRef: z.string(),
})

type ResolvedConfig = Required<Pick<Config, 'maxUploadBytes' | 'requestTimeoutMs' | 'allowInsecureHttp'>> & Pick<Config, 'agents' | 'registryUrl' | 'registryToken' | 'registryTokenRef' | 'relayAccessToken' | 'relayAccessTokenRef'>

function resolveConfig(config: Config): ResolvedConfig {
  return {
    agents: config.agents,
    ...(config.registryUrl === undefined ? {} : { registryUrl: config.registryUrl }),
    ...(config.registryToken === undefined ? {} : { registryToken: config.registryToken }),
    ...(config.registryTokenRef === undefined ? {} : { registryTokenRef: config.registryTokenRef }),
    maxUploadBytes: config.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES,
    requestTimeoutMs: config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    allowInsecureHttp: config.allowInsecureHttp ?? false,
    ...(config.relayAccessToken === undefined ? {} : { relayAccessToken: config.relayAccessToken }),
    ...(config.relayAccessTokenRef === undefined ? {} : { relayAccessTokenRef: config.relayAccessTokenRef }),
  }
}

function agentId(value: string): A2AAgentId {
  return value as A2AAgentId
}

function taskId(value: string) {
  return value as A2AGetTaskRequest['taskId']
}

function assertUrl(value: string, allowInsecureHttp: boolean, label: string): string {
  const parsed = new URL(value)
  if (parsed.protocol !== 'https:' && !(allowInsecureHttp && parsed.protocol === 'http:')) {
    throw new Error(`a2a-client: ${label} must use HTTPS (set allowInsecureHttp only for local development)`)
  }
  return parsed.toString()
}

function directoryUrl(value: string, allowInsecureHttp: boolean, label: string): URL {
  const parsed = new URL(assertUrl(value, allowInsecureHttp, label))
  if (!parsed.pathname.endsWith('/')) parsed.pathname += '/'
  return parsed
}

function assertSha256(value: string): void {
  if (!SHA256_PATTERN.test(value)) throw new Error('a2a-client: sha256 must be 64 lowercase hexadecimal characters')
}

function timeoutSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  if (signal === undefined) return timeout
  return AbortSignal.any([signal, timeout])
}

function fetchWithHeaders(
  headers: Readonly<Record<string, string>> | undefined,
  timeoutMs: number,
  outerSignal?: AbortSignal,
): typeof fetch {
  return async (input, init = {}) => {
    const merged = new Headers(headers)
    new Headers(init.headers).forEach((value, key) => { merged.set(key, value) })
    const initSignal = init.signal ?? undefined
    const signal = initSignal === undefined
      ? outerSignal
      : outerSignal === undefined
        ? initSignal
        : AbortSignal.any([outerSignal, initSignal])
    return fetch(input, { ...init, headers: merged, signal: timeoutSignal(signal, timeoutMs) })
  }
}

function textOfPart(part: Part): string {
  if (part.content?.$case === 'text') return part.content.value
  if (part.content?.$case === 'data') return JSON.stringify(part.content.value)
  if (part.content?.$case === 'url') return part.content.value
  return ''
}

function stateOfTask(value: unknown): string {
  return typeof value === 'number' ? taskStateToJSON(value) : String(value)
}

function jsonValue(value: unknown): A2AJsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value)) return value.map(jsonValue)
  if (typeof value === 'object') {
    const result: Record<string, A2AJsonValue> = {}
    for (const [key, item] of Object.entries(value)) result[key] = jsonValue(item)
    return result
  }
  throw new Error('a2a-client: structured A2A data part is not JSON-serializable')
}

function taskView(agent: A2AAgentId, value: Message | Task): A2ATaskView {
  if ('id' in value && 'status' in value) {
    const task = value
    return {
      kind: 'task',
      agentId: agent,
      taskId: taskId(task.id),
      contextId: task.contextId,
      ...(task.status?.state === undefined ? {} : { state: stateOfTask(task.status.state) }),
      text: [
        ...(task.status?.message?.parts ?? []).map(textOfPart),
        ...task.history.flatMap(message => message.parts.map(textOfPart)),
      ].filter(Boolean).join('\n'),
      artifacts: task.artifacts.map(artifact => ({
        id: artifact.artifactId,
        name: artifact.name,
        description: artifact.description,
        parts: artifact.parts.map((part) => {
          if (part.content?.$case === 'text') return { kind: 'text' as const, text: part.content.value, mediaType: part.mediaType }
          if (part.content?.$case === 'url') return { kind: 'url' as const, url: part.content.value, name: part.filename, mediaType: part.mediaType }
          if (part.content?.$case === 'data') return { kind: 'data' as const, data: jsonValue(part.content.value), mediaType: part.mediaType }
          return { kind: 'raw' as const, bytes: part.content?.value.byteLength ?? 0, name: part.filename, mediaType: part.mediaType }
        }),
      })),
    }
  }
  return {
    kind: 'message',
    agentId: agent,
    contextId: value.contextId,
    text: value.parts.map(textOfPart).filter(Boolean).join('\n'),
    artifacts: [],
  }
}

function cardView(agent: A2AAgentId, card: AgentCard): A2AAgentCardView {
  const protocols = card.supportedInterfaces.map(item => item.protocolVersion)
  const directUpload = (card.capabilities?.extensions ?? []).some(extension => extension.uri === A2A_DIRECT_UPLOAD_EXTENSION)
  return {
    agentId: agent,
    name: card.name,
    description: card.description,
    version: card.version,
    protocolVersions: protocols,
    streaming: card.capabilities?.streaming === true,
    directUpload,
    inputModes: card.defaultInputModes,
    outputModes: card.defaultOutputModes,
    skills: card.skills.map(skill => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      tags: skill.tags,
      examples: skill.examples,
      inputModes: skill.inputModes,
      outputModes: skill.outputModes,
    })),
  }
}

/** Host A2A provider using the official `@a2a-js/sdk` transports. */
export class A2AClientService extends TypertRemoteService implements A2AService {
  static inject = []
  static Config = Config

  private readonly context: Context
  private current: () => Config
  private readonly cards = new Map<string, Promise<AgentCard>>()
  private readonly registryAgents = new Map<string, A2AConfiguredAgent>()

  constructor(ctx: Context, config: Config) {
    super(ctx, 'a2a')
    this.context = ctx
    this.current = () => config
    const resolved = resolveConfig(config)
    if (resolved.registryUrl !== undefined) directoryUrl(resolved.registryUrl, resolved.allowInsecureHttp, 'registryUrl')
    for (const [id, value] of Object.entries(resolved.agents)) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error(`a2a-client: invalid Agent id ${JSON.stringify(id)}`)
      assertUrl(value.endpoint, resolved.allowInsecureHttp, `agents.${id}.endpoint`)
      if (value.cardUrl !== undefined) assertUrl(value.cardUrl, resolved.allowInsecureHttp, `agents.${id}.cardUrl`)
      if (value.uploadUrl !== undefined) assertUrl(value.uploadUrl, resolved.allowInsecureHttp, `agents.${id}.uploadUrl`)
    }
    // The client is also used as a standalone service in tests and SDK hosts
    // that do not mount the optional settings provider.
    if (ctx.get('settings') !== undefined) installSettingsSection(ctx, settingsNamespace('a2a-client'), Config, config, {
      setSource: (source) => { this.current = source },
      onChange: () => { this.cards.clear(); this.registryAgents.clear() },
    })
  }

  private get resolved(): ResolvedConfig { return resolveConfig(this.current()) }

  private async token(literal: string | undefined, ref: string | undefined): Promise<string | undefined> {
    if (literal !== undefined) return literal
    if (ref === undefined) return undefined
    const credentials = this.context.get('credentials')
    return credentials === undefined ? undefined : (await credentials.resolve(credentialRef(ref)))?.value
  }

  private async configFor(id: A2AAgentId): Promise<A2AConfiguredAgent> {
    const resolved = this.resolved
    const value = resolved.agents[String(id)] ?? this.registryAgents.get(String(id))
    if (value === undefined) throw new Error(`a2a-client: unknown Agent ${String(id)}; discover it from the Registry first`)
    const relayAccessToken = await this.token(resolved.relayAccessToken, resolved.relayAccessTokenRef)
    if (relayAccessToken === undefined
      || Object.keys(value.headers ?? {}).some(name => name.toLowerCase() === 'authorization')) return value
    return { ...value, headers: { ...value.headers, authorization: `Bearer ${relayAccessToken}` } }
  }

  /** Discover equal peers from the configured public Registry. */
  async searchAgents(skill?: string, signal?: AbortSignal): Promise<readonly A2AAgentView[]> {
    const resolved = this.resolved
    if (resolved.registryUrl === undefined) throw new Error('a2a-client: registryUrl is not configured')
    const url = new URL('v1/agents', directoryUrl(resolved.registryUrl, resolved.allowInsecureHttp, 'registryUrl'))
    if (skill !== undefined) url.searchParams.set('skill', skill)
    const registryToken = await this.token(resolved.registryToken, resolved.registryTokenRef)
    const headers = registryToken === undefined ? {} : { authorization: `Bearer ${registryToken}` }
    const response = await fetch(url, { headers, signal: timeoutSignal(signal, resolved.requestTimeoutMs) })
    if (!response.ok) throw new Error(`a2a-client: registry discovery failed with HTTP ${response.status}`)
    const body: unknown = await response.json()
    const records = typeof body === 'object' && body !== null && 'agents' in body ? body.agents : undefined
    if (!Array.isArray(records)) throw new Error('a2a-client: registry returned invalid agents')
    return records.map((value: unknown) => {
      if (typeof value !== 'object' || value === null) throw new Error('a2a-client: registry returned invalid Agent record')
      const record = value as Record<string, unknown>
      const discoveredId = record.agentId
      const endpoint = record.endpoint
      const cardUrl = record.cardUrl
      const uploadUrl = record.uploadUrl
      if (typeof discoveredId !== 'string' || typeof endpoint !== 'string' || typeof cardUrl !== 'string' || (uploadUrl !== undefined && typeof uploadUrl !== 'string')) {
        throw new Error('a2a-client: registry returned invalid Agent record')
      }
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(discoveredId)) throw new Error('a2a-client: registry returned invalid Agent id')
      assertUrl(endpoint, resolved.allowInsecureHttp, `Registry Agent ${discoveredId} endpoint`)
      assertUrl(cardUrl, resolved.allowInsecureHttp, `Registry Agent ${discoveredId} cardUrl`)
      if (uploadUrl !== undefined) {
        assertUrl(uploadUrl, resolved.allowInsecureHttp, `Registry Agent ${discoveredId} uploadUrl`)
      }
      this.registryAgents.set(discoveredId, {
        endpoint,
        cardUrl,
        ...(uploadUrl === undefined ? {} : { uploadUrl }),
      })
      return Object.freeze({ id: agentId(discoveredId), endpoint, directUpload: uploadUrl !== undefined })
    })
  }

  private async clientFor(id: A2AAgentId, signal?: AbortSignal) {
    const config = await this.configFor(id)
    let card = this.cards.get(String(id))
    if (card === undefined) {
      const fetchImpl = fetchWithHeaders(config.headers, this.resolved.requestTimeoutMs, signal)
      const resolver = new DefaultAgentCardResolver({ fetchImpl })
      const cardBase = config.cardUrl === undefined
        ? new URL('.well-known/agent-card.json', directoryUrl(config.endpoint, this.resolved.allowInsecureHttp, `agents.${String(id)}.endpoint`)).toString()
        : assertUrl(config.cardUrl, this.resolved.allowInsecureHttp, `agents.${String(id)}.cardUrl`)
      card = resolver.resolve(cardBase, '').catch((error: unknown) => {
        this.cards.delete(String(id))
        throw error
      })
      this.cards.set(String(id), card)
    }
    const resolvedCard = await card
    const fetchImpl = fetchWithHeaders(config.headers, this.resolved.requestTimeoutMs, signal)
    const factory = new ClientFactory({
      cardResolver: new DefaultAgentCardResolver({ fetchImpl }),
      transports: [new JsonRpcTransportFactory({ fetchImpl }), new RestTransportFactory({ fetchImpl })],
      clientConfig: { polling: true },
    })
    return {
      card: resolvedCard,
      client: await factory.createFromAgentCard(resolvedCard),
      signal: timeoutSignal(signal, this.resolved.requestTimeoutMs),
    }
  }

  listAgents(): readonly A2AAgentView[] {
    return Object.entries(this.resolved.agents).map(([id, value]) => Object.freeze({
      id: agentId(id), endpoint: value.endpoint, directUpload: value.uploadUrl !== undefined,
    }))
  }

  /** @returns the configured direct-upload byte cap. */
  maxUploadBytes(): number { return this.resolved.maxUploadBytes }

  /** List configured Agents without transport secrets.
   * @returns configured Agents without transport secrets.
   */
  @Remote('list')
  remoteListAgents(): readonly A2AAgentView[] { return this.listAgents() }

  /** Discover configured Registry peers without transport secrets.
   * @param skill - optional declared skill filter.
   * @param signal - cancels the Registry request.
   * @returns discovered peers.
   */
  @Remote('search')
  async remoteSearchAgents(skill?: string, signal?: AbortSignal): Promise<readonly A2AAgentView[]> {
    return this.searchAgents(skill, signal)
  }

  /**
   * @param id - configured Agent to inspect.
   * @param signal - cancels discovery.
   * @returns projected Agent Card.
   */
  @Remote('discover')
  async discover(id: A2AAgentId, signal?: AbortSignal): Promise<A2AAgentCardView> {
    const { card } = await this.clientFor(id, signal)
    return cardView(id, card)
  }

  @Remote('prepareUpload')
  async prepareUpload(request: A2APrepareUploadRequest, signal?: AbortSignal): Promise<A2AUploadTicket> {
    const config = await this.configFor(request.agentId)
    if (config.uploadUrl === undefined) throw new Error(`a2a-client: Agent ${String(request.agentId)} does not advertise direct upload`)
    if (!Number.isSafeInteger(request.byteLength) || request.byteLength < 0 || request.byteLength > this.resolved.maxUploadBytes) {
      throw new Error(`a2a-client: upload exceeds maxUploadBytes (${this.resolved.maxUploadBytes})`)
    }
    assertSha256(String(request.sha256))
    const response = await fetch(assertUrl(config.uploadUrl, this.resolved.allowInsecureHttp, `agents.${String(request.agentId)}.uploadUrl`), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...config.headers },
      body: JSON.stringify({ name: request.name, mediaType: request.mediaType, byteLength: request.byteLength, sha256: request.sha256 }),
      signal: timeoutSignal(signal, this.resolved.requestTimeoutMs),
    })
    if (!response.ok) throw new Error(`a2a-client: upload reservation failed with HTTP ${response.status}`)
    const value = await response.json() as Partial<A2AUploadTicket>
    const expiresAt = value.expiresAt
    if (value.agentId !== request.agentId
      || value.name !== request.name
      || value.mediaType !== request.mediaType
      || value.byteLength !== request.byteLength
      || value.sha256 !== request.sha256
      || typeof value.uploadUrl !== 'string'
      || value.uploadUrl.length === 0
      || typeof value.token !== 'string'
      || value.token.length === 0
      || typeof value.attachmentId !== 'string'
      || value.attachmentId.length === 0
      || typeof expiresAt !== 'number'
      || !Number.isSafeInteger(expiresAt)
      || expiresAt <= Date.now()) {
      throw new Error('a2a-client: upload reservation returned an invalid ticket')
    }
    assertUrl(value.uploadUrl, this.resolved.allowInsecureHttp, 'upload ticket URL')
    return {
      ...request,
      agentId: request.agentId,
      attachmentId: value.attachmentId,
      uploadUrl: value.uploadUrl,
      token: value.token,
      expiresAt,
    }
  }

  /** Upload bytes to a previously reserved ticket; not exported as a Remote because browsers upload directly. */
  async upload(ticket: A2AUploadTicket, bytes: Uint8Array, signal?: AbortSignal): Promise<void> {
    if (bytes.byteLength !== ticket.byteLength) throw new Error('a2a-client: upload byte length does not match the ticket')
    if (bytes.byteLength > this.resolved.maxUploadBytes) throw new Error('a2a-client: upload exceeds maxUploadBytes')
    const digest = createHash('sha256').update(bytes).digest('hex')
    if (digest !== ticket.sha256) throw new Error('a2a-client: upload SHA-256 does not match the ticket')
    const config = await this.configFor(ticket.agentId)
    const response = await fetch(ticket.uploadUrl, {
      method: 'PUT',
      headers: {
        ...config.headers,
        'content-type': ticket.mediaType,
        'content-length': String(bytes.byteLength),
        'x-dsh-a2a-upload-token': ticket.token,
      },
      body: Buffer.from(bytes),
      signal: timeoutSignal(signal, this.resolved.requestTimeoutMs),
    })
    if (!response.ok) throw new Error(`a2a-client: upload failed with HTTP ${response.status}`)
  }

  @Remote('send')
  async send(request: A2ASendRequest, signal?: AbortSignal): Promise<A2ATaskView> {
    const { client, signal: requestSignal } = await this.clientFor(request.agentId, signal)
    const attachments = request.attachments ?? []
    const message: Message = {
      messageId: crypto.randomUUID(), contextId: request.contextId ?? '', taskId: request.taskId === undefined ? '' : String(request.taskId), role: Role.ROLE_USER,
      parts: [{ content: { $case: 'text', value: request.prompt }, filename: '', mediaType: 'text/plain', metadata: undefined }], metadata: attachments.length === 0 ? undefined : { [A2A_DIRECT_UPLOAD_EXTENSION]: { attachments } }, extensions: attachments.length === 0 ? [] : [A2A_DIRECT_UPLOAD_EXTENSION], referenceTaskIds: [],
    }
    const response = await client.sendMessage({ tenant: '', message, configuration: { acceptedOutputModes: ['text/plain', 'application/json'], taskPushNotificationConfig: undefined, historyLength: 20, returnImmediately: true }, metadata: undefined }, { signal: requestSignal })
    return taskView(request.agentId, response)
  }

  @Remote('getTask')
  async getTask(request: A2AGetTaskRequest, signal?: AbortSignal): Promise<A2ATaskView> {
    const { client, signal: requestSignal } = await this.clientFor(request.agentId, signal)
    const task = await client.getTask({ tenant: '', id: String(request.taskId), historyLength: request.historyLength }, { signal: requestSignal })
    return taskView(request.agentId, task)
  }
}

export const name = 'a2a-client'
export const inject = ['typert']
export function apply(ctx: Context, config: Config): void {
  ctx.plugin(A2AClientService, config)
}

export default A2AClientService
