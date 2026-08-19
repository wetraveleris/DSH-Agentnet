import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { A2AClientService } from '../src/index.ts'
import type { A2APrepareUploadRequest } from '@deepseek-ai/dsh-a2a'

let context: Context | undefined

afterEach(async () => {
  vi.unstubAllGlobals()
  await context?.fiber.dispose()
  context = undefined
})

const request: A2APrepareUploadRequest = {
  agentId: 'lab' as A2APrepareUploadRequest['agentId'],
  name: 'hello.txt',
  mediaType: 'text/plain',
  byteLength: 5,
  sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824' as A2APrepareUploadRequest['sha256'],
}

function service(): A2AClientService {
  context = new Context()
  return new A2AClientService(context, {
    agents: { lab: { endpoint: 'https://agent.example', uploadUrl: 'https://agent.example/dsh/uploads' } },
    requestTimeoutMs: 1000,
    maxUploadBytes: 100,
  })
}

describe('A2A client upload reservations', () => {
  it('accepts a matching future ticket and preserves its fields', async () => {
    const expiresAt = Date.now() + 10_000
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      agentId: 'lab', attachmentId: 'attachment-1', uploadUrl: 'https://agent.example/dsh/uploads/attachment-1', token: 'ticket', expiresAt,
      name: request.name, mediaType: request.mediaType, byteLength: request.byteLength, sha256: request.sha256,
    }), { status: 201, headers: { 'content-type': 'application/json' } })))
    await expect(service().prepareUpload(request)).resolves.toMatchObject({ attachmentId: 'attachment-1', expiresAt })
  })

  it.each([
    ['wrong agent', { agentId: 'other' }],
    ['wrong digest', { sha256: '0'.repeat(64) }],
    ['expired', { expiresAt: 1 }],
  ])('rejects a ticket with %s metadata', async (_label, override) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      agentId: 'lab', attachmentId: 'attachment-1', uploadUrl: 'https://agent.example/dsh/uploads/attachment-1', token: 'ticket', expiresAt: Date.now() + 10_000,
      name: request.name, mediaType: request.mediaType, byteLength: request.byteLength, sha256: request.sha256, ...override,
    }), { status: 201, headers: { 'content-type': 'application/json' } })))
    await expect(service().prepareUpload(request)).rejects.toThrow('invalid ticket')
  })

  it('rejects plain HTTP endpoints unless explicitly enabled', () => {
    context = new Context()
    expect(() => new A2AClientService(context!, { agents: { lab: { endpoint: 'http://agent.example' } } })).toThrow('must use HTTPS')
  })

  it('passes the Relay access credential on the direct upload PUT', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer relay-access')
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)
    context = new Context()
    const client = new A2AClientService(context, {
      agents: { lab: { endpoint: 'https://relay.example/agents/lab', headers: { authorization: 'Bearer relay-access' } } },
      relayAccessToken: 'relay-access', requestTimeoutMs: 1000, maxUploadBytes: 100,
    })
    const ticket = {
      ...request,
      agentId: request.agentId,
      attachmentId: 'attachment-1' as never,
      uploadUrl: 'https://relay.example/agents/lab/dsh/uploads/attachment-1',
      token: 'ticket', expiresAt: Date.now() + 10_000,
    }
    await client.upload(ticket, new TextEncoder().encode('hello'))
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})

describe('A2A Registry discovery', () => {
  it('searches by skill, sends discovery credentials, and caches the returned peer', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url === 'https://registry.example/a2a-registry/v1/agents?skill=image-analysis') {
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer discovery-token')
        return new Response(JSON.stringify({ agents: [{
          agentId: 'b-vision', endpoint: 'https://b.example/a2a', uploadUrl: 'https://b.example/dsh/uploads',
        }] }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url === 'https://b.example/dsh/uploads') {
        return new Response(JSON.stringify({
          agentId: 'b-vision', attachmentId: 'attachment-1', uploadUrl: 'https://b.example/dsh/uploads/attachment-1', token: 'ticket', expiresAt: Date.now() + 10_000,
          name: request.name, mediaType: request.mediaType, byteLength: request.byteLength, sha256: request.sha256,
        }), { status: 201, headers: { 'content-type': 'application/json' } })
      }
      throw new Error(`unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    context = new Context()
    const client = new A2AClientService(context, {
      agents: {}, registryUrl: 'https://registry.example/a2a-registry', registryToken: 'discovery-token', requestTimeoutMs: 1000, maxUploadBytes: 100,
    })

    await expect(client.searchAgents('image-analysis')).resolves.toEqual([{
      id: 'b-vision', endpoint: 'https://b.example/a2a', directUpload: true,
    }])
    await expect(client.prepareUpload({ ...request, agentId: 'b-vision' as A2APrepareUploadRequest['agentId'] })).resolves.toMatchObject({ attachmentId: 'attachment-1' })
  })

  it('rejects Registry HTTP errors and insecure Registry URLs', async () => {
    const insecureContext = new Context()
    expect(() => new A2AClientService(insecureContext, { agents: {}, registryUrl: 'http://registry.example' })).toThrow('must use HTTPS')
    await insecureContext.fiber.dispose()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unavailable', { status: 503 })))
    context = new Context()
    const client = new A2AClientService(context, { agents: {}, registryUrl: 'https://registry.example' })
    await expect(client.searchAgents()).rejects.toThrow('HTTP 503')
  })
})
