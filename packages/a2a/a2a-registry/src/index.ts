/** HTTP registry for discoverable, equal-peer A2A Agents. @module @deepseek-ai/dsh-a2a-registry */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { Server } from 'node:http'
import express, { type Express, type Request, type Response } from 'express'

/** Public Agent record returned by discovery. */
export interface RegistryAgent {
  readonly agentId: string
  readonly cardUrl: string
  readonly endpoint: string
  readonly uploadUrl?: string
  readonly skills: readonly string[]
  readonly owner?: string
  readonly registeredAt: number
  readonly lastSeenAt: number
  readonly expiresAt: number
}

/** Registration payload supplied by a peer Agent. */
export interface AgentRegistration {
  readonly agentId: string
  readonly cardUrl: string
  readonly endpoint: string
  readonly uploadUrl?: string
  readonly skills: readonly string[]
  readonly owner?: string
}

/** Registry server configuration. */
export interface RegistryConfig {
  readonly host?: string
  readonly port?: number
  /** Public URL used only for diagnostics and deployment output. */
  readonly publicUrl?: string
  /** JSON file used for restart-safe registration records. */
  readonly dataFile?: string
  /** Token required for register, heartbeat, and revoke. */
  readonly registrationToken: string
  /** Optional token required for discovery endpoints. */
  readonly discoveryToken?: string
  /** Registration lifetime refreshed by heartbeat. */
  readonly leaseTtlMs?: number
}

interface StoredState {
  readonly agents: readonly RegistryAgent[]
}

const DEFAULT_LEASE_TTL_MS = 90_000
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

function headerToken(request: Request): string {
  const value = request.header('authorization')
  return value?.startsWith('Bearer ') ? value.slice(7) : ''
}

function authorized(request: Request, expected: string): boolean {
  return expected.length > 0 && headerToken(request) === expected
}

function assertUrl(value: string, label: string): void {
  let parsed: URL
  try { parsed = new URL(value) } catch { throw new Error(`a2a-registry: ${label} must be an absolute URL`) }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error(`a2a-registry: ${label} must use HTTP or HTTPS`)
}

function parseRegistration(value: unknown): AgentRegistration {
  if (typeof value !== 'object' || value === null) throw new Error('registration must be an object')
  const body = value as Record<string, unknown>
  const agentId = body.agentId
  const cardUrl = body.cardUrl
  const endpoint = body.endpoint
  const uploadUrl = body.uploadUrl
  const skills = body.skills
  const owner = body.owner
  if (typeof agentId !== 'string' || !ID_PATTERN.test(agentId)) throw new Error('agentId must contain 1-64 ASCII letters, digits, underscores, or hyphens')
  if (typeof cardUrl !== 'string') throw new Error('cardUrl is required')
  if (typeof endpoint !== 'string') throw new Error('endpoint is required')
  assertUrl(cardUrl, 'cardUrl'); assertUrl(endpoint, 'endpoint')
  if (uploadUrl !== undefined) { if (typeof uploadUrl !== 'string') throw new Error('uploadUrl must be a URL'); assertUrl(uploadUrl, 'uploadUrl') }
  if (!Array.isArray(skills) || skills.some(skill => typeof skill !== 'string' || skill.length === 0 || skill.length > 128)) throw new Error('skills must be a non-empty string array')
  if (owner !== undefined && (typeof owner !== 'string' || owner.length > 256)) throw new Error('owner must be a short string')
  return {
    agentId,
    cardUrl,
    endpoint,
    ...(uploadUrl === undefined ? {} : { uploadUrl }),
    skills: [...new Set(skills)] as string[],
    ...(owner === undefined ? {} : { owner }),
  }
}

function live(records: Iterable<RegistryAgent>, now = Date.now()): RegistryAgent[] {
  return [...records].filter(record => record.expiresAt > now)
}

/** In-memory registry store with optional atomic JSON persistence. */
export class RegistryStore {
  private readonly records = new Map<string, RegistryAgent>()
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private readonly dataFile: string | undefined, private readonly leaseTtlMs: number) {}

  /** Load persisted records and discard expired leases. */
  async load(): Promise<void> {
    if (this.dataFile === undefined) return
    try {
      const parsed = JSON.parse(await readFile(this.dataFile, 'utf8')) as StoredState
      if (!Array.isArray(parsed.agents)) throw new Error('agents is not an array')
      for (const record of live(parsed.agents)) this.records.set(record.agentId, record)
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw new Error(`a2a-registry: cannot load ${this.dataFile}`, { cause: error })
    }
  }

  /**
   * Register or replace one peer lease.
   * @param payload - public peer metadata and endpoint URLs.
   * @param now - timestamp used for lease fields.
   * @returns the stored live registration.
   */
  register(payload: AgentRegistration, now = Date.now()): RegistryAgent {
    const previous = this.records.get(payload.agentId)
    const record: RegistryAgent = {
      ...payload,
      ...(previous === undefined ? { registeredAt: now } : { registeredAt: previous.registeredAt }),
      lastSeenAt: now,
      expiresAt: now + this.leaseTtlMs,
    }
    this.records.set(record.agentId, record)
    this.scheduleWrite()
    return record
  }

  /**
   * Refresh an existing lease, optionally replacing its public metadata.
   * @param agentId - registered peer identity.
   * @param patch - public fields to replace.
   * @param now - timestamp used for lease fields.
   * @returns the refreshed registration, or undefined when the peer is absent.
   */
  heartbeat(agentId: string, patch: Partial<AgentRegistration>, now = Date.now()): RegistryAgent | undefined {
    const current = this.records.get(agentId)
    if (current === undefined) return undefined
    const next = {
      agentId,
      cardUrl: patch.cardUrl ?? current.cardUrl,
      endpoint: patch.endpoint ?? current.endpoint,
      uploadUrl: patch.uploadUrl ?? current.uploadUrl,
      skills: patch.skills ?? current.skills,
      owner: patch.owner ?? current.owner,
    }
    const payload = parseRegistration(next)
    return this.register(payload, now)
  }

  /**
   * Remove one lease.
   * @param agentId - registered peer identity.
   * @returns whether a registration was removed.
   */
  revoke(agentId: string): boolean {
    const deleted = this.records.delete(agentId)
    if (deleted) this.scheduleWrite()
    return deleted
  }

  /**
   * Return live records, optionally filtered by declared skill.
   * @param skill - optional exact skill id.
   * @returns non-expired registrations.
   */
  list(skill?: string): readonly RegistryAgent[] {
    const records = live(this.records.values())
    for (const record of this.records.values()) if (record.expiresAt <= Date.now()) this.records.delete(record.agentId)
    return skill === undefined ? records : records.filter(record => record.skills.includes(skill))
  }

  /**
   * Return one live record.
   * @param agentId - registered peer identity.
   * @returns the live registration, or undefined when absent or expired.
   */
  get(agentId: string): RegistryAgent | undefined {
    const record = this.records.get(agentId)
    return record !== undefined && record.expiresAt > Date.now() ? record : undefined
  }

  /** Remove expired leases and persist the result. */
  prune(): void {
    let changed = false
    for (const record of this.records.values()) if (record.expiresAt <= Date.now()) { this.records.delete(record.agentId); changed = true }
    if (changed) this.scheduleWrite()
  }

  private scheduleWrite(): void {
    const dataFile = this.dataFile
    if (dataFile === undefined) return
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(dataFile), { recursive: true })
      const temporary = `${dataFile}.tmp`
      await writeFile(temporary, JSON.stringify({ agents: this.list() } satisfies StoredState), { mode: 0o600 })
      await rename(temporary, dataFile)
    })
  }

  /** Await writes scheduled before this call. */
  async flush(): Promise<void> { await this.writeQueue }
}

/** Resources returned by one registry instance. */
export interface RegistryHandle {
  readonly app: Express
  readonly store: RegistryStore
  readonly config: Required<Pick<RegistryConfig, 'host' | 'port' | 'leaseTtlMs'>> & Pick<RegistryConfig, 'publicUrl' | 'dataFile'>
  readonly close: () => Promise<void>
}

/**
 * Create an unbound registry application.
 * @param config - registry binding, lease, persistence, and token settings.
 * @returns an initialized registry handle whose app can be mounted or started.
 */
export async function createRegistry(config: RegistryConfig): Promise<RegistryHandle> {
  if (config.registrationToken.length < 16) throw new Error('a2a-registry: registrationToken must contain at least 16 characters')
  const leaseTtlMs = config.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS
  if (!Number.isSafeInteger(leaseTtlMs) || leaseTtlMs < 10_000) throw new Error('a2a-registry: leaseTtlMs must be at least 10000 milliseconds')
  const resolved = {
    host: config.host ?? '127.0.0.1', port: config.port ?? 18100, leaseTtlMs,
    ...(config.publicUrl === undefined ? {} : { publicUrl: config.publicUrl }),
    ...(config.dataFile === undefined ? {} : { dataFile: resolve(config.dataFile) }),
  }
  if (!Number.isSafeInteger(resolved.port) || resolved.port < 0 || resolved.port > 65535) throw new Error('a2a-registry: port must be a valid TCP port or 0')
  if (resolved.publicUrl !== undefined) assertUrl(resolved.publicUrl, 'publicUrl')
  const store = new RegistryStore(resolved.dataFile, resolved.leaseTtlMs)
  await store.load()
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '64kb' }))
  app.use((request, response, next) => { response.setHeader('Access-Control-Allow-Origin', '*'); response.setHeader('Access-Control-Allow-Headers', 'authorization,content-type'); response.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS'); if (request.method === 'OPTIONS') { response.status(204).end(); return } next() })
  app.get('/healthz', (_request, response) => { response.json({ ok: true, service: 'dsh-a2a-registry' }) })
  app.post('/v1/agents/register', async (request, response) => {
    if (!authorized(request, config.registrationToken)) { response.status(401).json({ error: 'registration authorization required' }); return }
    try {
      const record = store.register(parseRegistration(request.body))
      await store.flush()
      response.status(201).json(record)
    } catch (error: unknown) { response.status(400).json({ error: error instanceof Error ? error.message : 'invalid registration' }) }
  })
  app.post('/v1/agents/:agentId/heartbeat', async (request, response) => {
    if (!authorized(request, config.registrationToken)) { response.status(401).json({ error: 'registration authorization required' }); return }
    const agentId = request.params.agentId
    if (!ID_PATTERN.test(agentId)) { response.status(400).json({ error: 'invalid agentId' }); return }
    try {
      const current = store.get(agentId)
      if (current === undefined) { response.status(404).json({ error: 'agent is not registered' }); return }
      const patch = request.body as Partial<AgentRegistration>
      const record = store.heartbeat(agentId, patch)
      if (record === undefined) { response.status(404).json({ error: 'agent is not registered' }); return }
      await store.flush()
      response.json(record)
    } catch (error: unknown) { response.status(400).json({ error: error instanceof Error ? error.message : 'invalid heartbeat' }) }
  })
  app.delete('/v1/agents/:agentId', async (request, response) => {
    if (!authorized(request, config.registrationToken)) { response.status(401).json({ error: 'registration authorization required' }); return }
    const revoked = store.revoke(request.params.agentId)
    if (revoked) await store.flush()
    response.status(revoked ? 204 : 404).end()
  })
  const requireDiscovery = (request: Request, response: Response): boolean => {
    if (config.discoveryToken === undefined || authorized(request, config.discoveryToken)) return true
    response.status(401).json({ error: 'discovery authorization required' }); return false
  }
  app.get('/v1/agents', (request, response) => { if (!requireDiscovery(request, response)) return; const skill = typeof request.query.skill === 'string' ? request.query.skill : undefined; response.json({ agents: store.list(skill) }) })
  app.get('/v1/agents/:agentId', (request, response) => { if (!requireDiscovery(request, response)) return; const record = store.get(request.params.agentId); if (record === undefined) { response.status(404).json({ error: 'agent not found' }); return } response.json(record) })
  const cleanup = setInterval(() => { store.prune() }, Math.min(resolved.leaseTtlMs, 60_000))
  return { app, store, config: resolved, close: async () => { clearInterval(cleanup); await store.flush() } }
}

/**
 * Bind the registry HTTP server.
 * @param config - registry binding, lease, persistence, and token settings.
 * @returns the registry handle and its listening HTTP server.
 */
export async function startRegistry(config: RegistryConfig): Promise<RegistryHandle & { readonly server: Server }> {
  const registry = await createRegistry(config)
  const server = await new Promise<Server>((resolveServer, reject) => {
    const value = registry.app.listen(registry.config.port, registry.config.host, () => { resolveServer(value) })
    value.once('error', reject)
  })
  return {
    ...registry,
    server,
    close: async () => {
      await new Promise<void>((resolveClose, reject) => {
        server.close((error) => { if (error === undefined) resolveClose(); else reject(error) })
      })
      await registry.close()
    },
  }
}

export const name = 'a2a-registry'
