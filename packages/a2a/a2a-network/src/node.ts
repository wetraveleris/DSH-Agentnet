/** Outbound A2A peer node: loopback Gateway plus a Relay tunnel and Registry lease. */

import WebSocket from 'ws'
import type { RawData } from 'ws'
import { startGateway, type GatewayConfig } from '@deepseek-ai/dsh-a2a-gateway'
import type { TunnelRequestFrame, TunnelResponseFrame } from './protocol.ts'

/** Public peer-node configuration. */
export interface NodeConfig {
  /** Stable peer identity. */
  readonly agentId: string
  /** Public Relay base URL, for example `https://agents.example.com`. */
  readonly relayUrl: string
  /** Shared node admission token for the Relay. */
  readonly relayToken: string
  /** Optional Registry endpoint. */
  readonly registryUrl?: string
  /** Registry registration/heartbeat token. */
  readonly registryToken?: string
  /** Public capabilities exposed in the Agent Card. */
  readonly gateway: Omit<GatewayConfig, 'host' | 'port' | 'publicUrl' | 'agentId'>
  /** How frequently to renew the Registry lease. */
  readonly heartbeatMs?: number
  /** Relay request body cap. */
  readonly maxBodyBytes?: number
  /** Initial reconnect delay after an unexpected tunnel close. */
  readonly reconnectMs?: number
  /** Maximum reconnect delay after repeated tunnel failures. */
  readonly maxReconnectMs?: number
}

/** Running node resources. */
export interface NodeHandle {
  /** Loopback Gateway and its temporary upload store. */
  readonly gateway: Awaited<ReturnType<typeof startGateway>>
  /** Outbound Relay socket. */
  /** Current outbound Relay socket. */
  readonly socket: WebSocket
  /** Stop the Gateway, socket, and heartbeat. */
  readonly close: () => Promise<void>
}

const DEFAULT_HEARTBEAT_MS = 30_000
const DEFAULT_MAX_BODY_BYTES = 12 * 1024 * 1024

function rawText(raw: RawData): string {
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8')
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString('utf8')
  return raw.toString('utf8')
}

function relaySocketUrl(relayUrl: string, agentId: string): string {
  const value = new URL(relayUrl)
  value.protocol = value.protocol === 'https:' ? 'wss:' : value.protocol === 'http:' ? 'ws:' : value.protocol
  value.pathname = `${value.pathname.replace(/\/$/, '')}/v1/tunnel`
  value.searchParams.set('agentId', agentId)
  return value.toString()
}

function relayHttpUrl(relayUrl: string, agentId: string): string {
  const value = new URL(relayUrl)
  value.pathname = `${value.pathname.replace(/\/$/, '')}/agents/${agentId}`
  return value.toString().replace(/\/$/, '')
}

async function registryRequest(config: NodeConfig, method: 'POST', path: string, body: unknown): Promise<void> {
  if (config.registryUrl === undefined || config.registryToken === undefined) return
  const url = new URL(path.replace(/^\//, ''), config.registryUrl.endsWith('/') ? config.registryUrl : `${config.registryUrl}/`)
  const response = await fetch(url, { method, headers: { authorization: `Bearer ${config.registryToken}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error(`a2a-node: Registry ${method} ${path} failed with HTTP ${response.status}`)
}

async function proxyRequest(gatewayUrl: string, frame: TunnelRequestFrame, maxBodyBytes: number): Promise<TunnelResponseFrame> {
  const body = Buffer.from(frame.body, 'base64')
  if (body.byteLength > maxBodyBytes) throw new Error('request body exceeds node maximum')
  const init: RequestInit = { method: frame.method, headers: frame.headers }
  if (frame.method !== 'GET' && frame.method !== 'HEAD') init.body = body
  const response = await fetch(`${gatewayUrl}${frame.path}`, init)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.byteLength > maxBodyBytes) throw new Error('response body exceeds node maximum')
  const headers: Record<string, string> = {}
  response.headers.forEach((value, name) => { headers[name] = value })
  return { type: 'response', id: frame.id, status: response.status, headers, body: bytes.toString('base64') }
}

/**
 * Start a node that makes one outbound connection to the public Relay.
 * @param config - peer identity, Relay credentials, Registry lease, and local Agent Card/executor.
 * @returns running node resources.
 */
export async function startNode(config: NodeConfig): Promise<NodeHandle> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(config.agentId)) throw new Error('a2a-node: agentId is invalid')
  if (config.relayToken.length < 16) throw new Error('a2a-node: relayToken must contain at least 16 characters')
  const maxBodyBytes = config.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
  const publicUrl = relayHttpUrl(config.relayUrl, config.agentId)
  const gateway = await startGateway({
    ...config.gateway,
    agentId: config.agentId,
    host: '127.0.0.1',
    port: 0,
    publicUrl,
  })
  const address = gateway.server.address()
  if (address === null || typeof address === 'string') { await gateway.close(); throw new Error('a2a-node: local Gateway did not expose a TCP address') }
  const gatewayUrl = `http://127.0.0.1:${String(address.port)}`
  const registration = {
    agentId: config.agentId,
    cardUrl: `${publicUrl}/.well-known/agent-card.json`,
    endpoint: publicUrl,
    uploadUrl: `${publicUrl}/dsh/uploads`,
    skills: (config.gateway.skills ?? []).map(skill => skill.id),
  }
  let socket: WebSocket | undefined
  let stopped = false
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let reconnectDelay = config.reconnectMs ?? 1_000
  const maxReconnectMs = config.maxReconnectMs ?? 30_000
  const connect = (): Promise<WebSocket> => new Promise((resolve, reject) => {
    const candidate = new WebSocket(relaySocketUrl(config.relayUrl, config.agentId), { headers: { authorization: `Bearer ${config.relayToken}` }, maxPayload: maxBodyBytes })
    const ready = (): void => { candidate.removeListener('error', fail); reconnectDelay = config.reconnectMs ?? 1_000; resolve(candidate) }
    const fail = (error: Error): void => { candidate.removeListener('open', ready); reject(error) }
    candidate.once('error', fail)
    candidate.once('open', ready)
    candidate.on('message', (raw) => {
      let frame: unknown
      try { frame = JSON.parse(rawText(raw)) } catch { candidate.close(1007, 'invalid Relay frame'); return }
      if (typeof frame !== 'object' || frame === null || (frame as { type?: unknown }).type !== 'request') return
      const request = frame as TunnelRequestFrame
      void proxyRequest(gatewayUrl, request, maxBodyBytes).then((reply) => {
        if (candidate.readyState === WebSocket.OPEN) candidate.send(JSON.stringify(reply))
      }).catch((error: unknown) => {
        if (candidate.readyState === WebSocket.OPEN) candidate.send(JSON.stringify({ type: 'failure', id: request.id, message: error instanceof Error ? error.message : String(error) }))
      })
    })
    candidate.once('close', () => { if (!stopped && socket === candidate) { socket = undefined; scheduleReconnect() } })
  })
  const scheduleReconnect = (): void => {
    if (stopped || reconnectTimer !== undefined) return
    const delay = reconnectDelay
    reconnectDelay = Math.min(maxReconnectMs, Math.max(delay * 2, delay + 1))
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined
      void connect().then((next) => {
        socket = next
        void registryRequest(config, 'POST', 'v1/agents/register', registration).catch(() => undefined)
      }).catch(() => { scheduleReconnect() })
    }, delay)
  }
  try { socket = await connect() } catch (error: unknown) { await gateway.close(); throw error }
  await registryRequest(config, 'POST', 'v1/agents/register', registration).catch(async (error: unknown) => { stopped = true; socket?.close(); await gateway.close(); throw error })
  const heartbeat = setInterval(() => { void registryRequest(config, 'POST', `v1/agents/${config.agentId}/heartbeat`, {}).catch(() => undefined) }, config.heartbeatMs ?? DEFAULT_HEARTBEAT_MS)
  return {
    gateway,
    get socket() {
      if (socket === undefined) throw new Error('a2a-node: Relay tunnel is reconnecting')
      return socket
    },
    close: async () => {
      clearInterval(heartbeat)
      stopped = true
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer)
      socket?.close(1000, 'node shutdown')
      await gateway.close()
      await registryRequest(config, 'POST', `v1/agents/${config.agentId}/heartbeat`, {}).catch(() => undefined)
    },
  }
}
