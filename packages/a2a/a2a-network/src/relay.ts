/** Public HTTP-to-WebSocket Relay for outbound A2A peer nodes. */

import { randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import WebSocket, { WebSocketServer } from 'ws'
import type { RawData } from 'ws'
import type { TunnelNodeFrame, TunnelRequestFrame, TunnelResponseFrame } from './protocol.ts'

/** Relay process configuration. */
export interface RelayConfig {
  /** Public HTTPS base URL, used to construct each peer's externally visible URL. */
  readonly publicUrl: string
  /** Token required when a node opens an outbound tunnel. */
  readonly joinToken: string
  /** Optional token required to call any published peer. */
  readonly accessToken?: string
  /** Bind address. */
  readonly host?: string
  /** Bind port. */
  readonly port?: number
  /** Maximum body size relayed in either direction. */
  readonly maxBodyBytes?: number
  /** Maximum wait for one node response. */
  readonly requestTimeoutMs?: number
}

/** Resources owned by one Relay server. */
export interface RelayHandle {
  /** Bound HTTP server. */
  readonly server: Server
  /** Resolved external base URL. */
  readonly publicUrl: string
  /** Return a public base URL for a connected peer id. */
  readonly agentUrl: (agentId: string) => string
  /** Stop accepting public requests and close every owned tunnel. */
  readonly close: () => Promise<void>
}

const AGENT_ID = /^[A-Za-z0-9_-]{1,64}$/
const DEFAULT_MAX_BODY_BYTES = 10 * 1024 * 1024 + 1024 * 1024
const DEFAULT_REQUEST_TIMEOUT_MS = 90_000
const HOP_HEADERS = new Set(['connection', 'content-length', 'host', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'])

function rawText(raw: RawData): string {
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8')
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString('utf8')
  return raw.toString('utf8')
}

function tokenMatches(value: string | undefined, expected: string): boolean {
  if (value === undefined || !value.startsWith('Bearer ')) return false
  const supplied = Buffer.from(value.slice(7))
  const known = Buffer.from(expected)
  return supplied.byteLength === known.byteLength && timingSafeEqual(supplied, known)
}

function json(socket: WebSocket, value: unknown): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value))
}

function response(response: ServerResponse, status: number, text: string): void {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.end(JSON.stringify({ error: text }))
}

function headersOf(request: IncomingMessage): Readonly<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const [name, value] of Object.entries(request.headers)) {
    const lowered = name.toLowerCase()
    if (HOP_HEADERS.has(lowered) || lowered === 'authorization' || value === undefined) continue
    result[lowered] = Array.isArray(value) ? value.join(', ') : value
  }
  return result
}

function responseHeaders(value: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const [name, header] of Object.entries(value)) {
    const lowered = name.toLowerCase()
    if (HOP_HEADERS.has(lowered) || lowered === 'set-cookie') continue
    result[lowered] = header
  }
  return result
}

async function bodyOf(request: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = request.headers['content-length']
  if (typeof declared === 'string' && Number.parseInt(declared, 10) > limit) throw new Error('request body exceeds relay maximum')
  const parts: Uint8Array[] = []
  let total = 0
  for await (const part of request) {
    const bytes = Buffer.isBuffer(part) ? new Uint8Array(part) : new Uint8Array(part as Uint8Array)
    total += bytes.byteLength
    if (total > limit) throw new Error('request body exceeds relay maximum')
    parts.push(bytes)
  }
  return Buffer.concat(parts)
}

function requestTarget(url: string | undefined): { readonly agentId: string; readonly path: string } | undefined {
  if (url === undefined) return undefined
  const parsed = new URL(url, 'http://relay.invalid')
  const match = /^\/agents\/([A-Za-z0-9_-]{1,64})(\/.*)?$/.exec(parsed.pathname)
  if (match === null) return undefined
  const agentId = match[1]
  if (agentId === undefined) return undefined
  return { agentId, path: `${match[2] ?? '/'}${parsed.search}` }
}

function nodeFrame(value: unknown): TunnelNodeFrame | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const frame = value as Partial<TunnelNodeFrame>
  if (typeof frame.id !== 'string' || (frame.type !== 'response' && frame.type !== 'failure')) return undefined
  if (frame.type === 'failure') return typeof frame.message === 'string' ? { type: 'failure', id: frame.id, message: frame.message } : undefined
  const responseFrame = frame as Partial<TunnelResponseFrame>
  const rawHeaders: unknown = responseFrame.headers
  if (typeof responseFrame.status !== 'number' || typeof responseFrame.body !== 'string' || typeof rawHeaders !== 'object' || rawHeaders === null) return undefined
  const headers: Record<string, string> = {}
  for (const [name, item] of Object.entries(rawHeaders)) {
    if (typeof item !== 'string') return undefined
    headers[name] = item
  }
  return { type: 'response', id: frame.id, status: responseFrame.status, headers, body: responseFrame.body }
}

/**
 * Start a public Relay. Nodes connect outward to `/v1/tunnel`; callers use
 * `/agents/{agentId}/...`, which preserves the standard A2A URL layout.
 * @param config - public URL, node admission token, and bounded forwarding policy.
 * @returns the bound Relay and its shutdown handle.
 */
export async function startRelay(config: RelayConfig): Promise<RelayHandle> {
  if (config.joinToken.length < 16) throw new Error('a2a-relay: joinToken must contain at least 16 characters')
  const publicUrl = new URL(config.publicUrl)
  if (publicUrl.protocol !== 'https:' && publicUrl.protocol !== 'http:') throw new Error('a2a-relay: publicUrl must use HTTP or HTTPS')
  publicUrl.pathname = publicUrl.pathname.replace(/\/$/, '')
  const maxBodyBytes = config.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
  const requestTimeoutMs = config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1) throw new Error('a2a-relay: maxBodyBytes must be positive')
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1) throw new Error('a2a-relay: requestTimeoutMs must be positive')
  const tunnels = new Map<string, WebSocket>()
  const pending = new Map<string, { readonly response: ServerResponse; readonly timer: ReturnType<typeof setTimeout> }>()
  const sockets = new WebSocketServer({ noServer: true })

  const server = createServer((request, reply) => {
    void (async () => {
      if (request.method === 'GET' && request.url === '/healthz') {
        reply.setHeader('content-type', 'application/json; charset=utf-8')
        reply.end(JSON.stringify({ ok: true, service: 'dsh-a2a-relay', connectedAgents: [...tunnels.keys()] }))
        return
      }
      const target = requestTarget(request.url)
      if (target === undefined) { response(reply, 404, 'unknown Relay endpoint'); return }
      if (config.accessToken !== undefined && !tokenMatches(request.headers.authorization, config.accessToken)) { response(reply, 401, 'Relay access authorization required'); return }
      const tunnel = tunnels.get(target.agentId)
      if (tunnel === undefined || tunnel.readyState !== WebSocket.OPEN) { response(reply, 503, 'Agent is not connected to the Relay'); return }
      let body: Buffer
      try { body = await bodyOf(request, maxBodyBytes) } catch (error: unknown) { response(reply, 413, error instanceof Error ? error.message : 'request body rejected'); return }
      const id = randomUUID()
      const timer = setTimeout(() => {
        const current = pending.get(id)
        if (current === undefined) return
        pending.delete(id)
        response(current.response, 504, 'Agent did not respond before the Relay timeout')
      }, requestTimeoutMs)
      pending.set(id, { response: reply, timer })
      const frame: TunnelRequestFrame = { type: 'request', id, method: request.method ?? 'GET', path: target.path, headers: headersOf(request), body: body.toString('base64') }
      try { json(tunnel, frame) } catch {
        clearTimeout(timer)
        pending.delete(id)
        response(reply, 503, 'Agent tunnel closed before Relay delivery')
      }
    })().catch((error: unknown) => {
      if (!reply.headersSent) response(reply, 500, error instanceof Error ? error.message : 'Relay failure')
      else reply.destroy()
    })
  })

  server.on('upgrade', (request, socket, head) => {
    const parsed = new URL(request.url ?? '/', 'http://relay.invalid')
    const agentId = parsed.searchParams.get('agentId')
    if (parsed.pathname !== '/v1/tunnel' || agentId === null || !AGENT_ID.test(agentId) || !tokenMatches(request.headers.authorization, config.joinToken)) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      return
    }
    sockets.handleUpgrade(request, socket, head, (websocket) => {
      const previous = tunnels.get(agentId)
      if (previous !== undefined && previous !== websocket) previous.close(4001, 'replaced by a newer node connection')
      tunnels.set(agentId, websocket)
      websocket.on('message', (raw) => {
        let parsedFrame: unknown
        try { parsedFrame = JSON.parse(rawText(raw)) } catch { websocket.close(1007, 'invalid tunnel JSON'); return }
        const frame = nodeFrame(parsedFrame)
        if (frame === undefined) { websocket.close(1008, 'invalid tunnel frame'); return }
        const current = pending.get(frame.id)
        if (current === undefined) return
        pending.delete(frame.id)
        clearTimeout(current.timer)
        if (frame.type === 'failure') { response(current.response, 502, frame.message); return }
        const body = Buffer.from(frame.body, 'base64')
        if (body.byteLength > maxBodyBytes) { response(current.response, 502, 'Agent response exceeds Relay maximum'); return }
        current.response.statusCode = frame.status
        for (const [name, header] of Object.entries(responseHeaders(frame.headers))) current.response.setHeader(name, header)
        current.response.end(body)
      })
      websocket.once('close', () => { if (tunnels.get(agentId) === websocket) tunnels.delete(agentId) })
      websocket.once('error', () => { if (tunnels.get(agentId) === websocket) tunnels.delete(agentId) })
      json(websocket, { type: 'connected', agentId })
    })
  })

  const port = config.port ?? 18080
  const host = config.host ?? '127.0.0.1'
  await new Promise<void>((resolveStart, reject) => { server.listen(port, host, resolveStart); server.once('error', reject) })
  const address = server.address()
  const resolvedPublicUrl = new URL(publicUrl.toString())
  if (resolvedPublicUrl.port === '' && address !== null && typeof address !== 'string') resolvedPublicUrl.port = String(address.port)
  const publishedUrl = resolvedPublicUrl.toString().replace(/\/$/, '')
  return {
    server,
    publicUrl: publishedUrl,
    agentUrl: (agentId) => {
      if (!AGENT_ID.test(agentId)) throw new Error('a2a-relay: invalid Agent id')
      return `${publishedUrl}/agents/${agentId}`
    },
    close: async () => {
      for (const socket of sockets.clients) socket.terminate()
      for (const entry of pending.values()) { clearTimeout(entry.timer); response(entry.response, 503, 'Relay is shutting down') }
      pending.clear()
      await new Promise<void>((resolveClose, reject) => {
        server.close((error) => { if (error === undefined) resolveClose(); else reject(error) })
      })
      await new Promise<void>((resolveClose, reject) => {
        sockets.close((error) => { if (error === undefined) resolveClose(); else reject(error) })
      })
    },
  }
}
