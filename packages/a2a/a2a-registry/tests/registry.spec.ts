import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { createRegistry } from '../src/index.ts'

const TOKEN = 'registry-test-token-12345'

interface Running {
  readonly server: Server
  readonly url: string
  readonly dataFile: string
  readonly close: () => Promise<void>
}

let active: Running | undefined

afterEach(async () => { await active?.close(); active = undefined })

async function running(): Promise<Running> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-a2a-registry-'))
  const dataFile = join(root, 'registry.json')
  const registry = await createRegistry({ host: '127.0.0.1', port: 0, dataFile, registrationToken: TOKEN })
  const server = await new Promise<Server>((resolveServer, reject) => {
    const value = registry.app.listen(0, '127.0.0.1', () => { resolveServer(value) })
    value.once('error', reject)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('registry did not expose a TCP address')
  return {
    server,
    url: `http://127.0.0.1:${String(address.port)}`,
    dataFile,
    close: async () => {
      await new Promise<void>((resolveClose, reject) => {
        server.close((error) => { if (error === undefined) resolveClose(); else reject(error) })
      })
      await registry.close()
      await rm(root, { recursive: true, force: true })
    },
  }
}

const registration = { agentId: 'b-vision', cardUrl: 'https://b.example/.well-known/agent-card.json', endpoint: 'https://b.example/a2a', uploadUrl: 'https://b.example/dsh/uploads', skills: ['image-analysis'] }

describe('A2A registry', () => {
  it('registers, searches, heartbeats, persists, and revokes equal peers', async () => {
    active = await running()
    const register = await fetch(`${active.url}/v1/agents/register`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(registration) })
    expect(register.status).toBe(201)
    expect(await register.json()).toMatchObject({ agentId: 'b-vision', skills: ['image-analysis'] })
    const listed = await fetch(`${active.url}/v1/agents?skill=image-analysis`)
    expect(listed.status).toBe(200)
    expect(await listed.json()).toMatchObject({ agents: [{ agentId: 'b-vision' }] })
    const heartbeat = await fetch(`${active.url}/v1/agents/b-vision/heartbeat`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: '{}' })
    expect(heartbeat.status).toBe(200)
    expect(await readFile(active.dataFile, 'utf8')).toContain('b-vision')
    const revoked = await fetch(`${active.url}/v1/agents/b-vision`, { method: 'DELETE', headers: { authorization: `Bearer ${TOKEN}` } })
    expect(revoked.status).toBe(204)
    await expect((await fetch(`${active.url}/v1/agents`)).json()).resolves.toEqual({ agents: [] })
  })

  it('rejects unauthenticated registration and malformed peer metadata', async () => {
    active = await running()
    const unauthorized = await fetch(`${active.url}/v1/agents/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(registration) })
    expect(unauthorized.status).toBe(401)
    const malformed = await fetch(`${active.url}/v1/agents/register`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ ...registration, agentId: '../escape' }) })
    expect(malformed.status).toBe(400)
  })

  it('hides discovery when a discovery token is configured', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-a2a-registry-auth-'))
    const registry = await createRegistry({ host: '127.0.0.1', port: 0, dataFile: join(root, 'registry.json'), registrationToken: TOKEN, discoveryToken: 'discovery-token-12345' })
    const server = await new Promise<Server>((resolveServer, reject) => {
      const value = registry.app.listen(0, '127.0.0.1', () => { resolveServer(value) })
      value.once('error', reject)
    })
    const address = server.address(); if (address === null || typeof address === 'string') throw new Error('registry did not expose a TCP address')
    const url = `http://127.0.0.1:${String(address.port)}`
    try {
      expect((await fetch(`${url}/v1/agents`)).status).toBe(401)
      expect((await fetch(`${url}/v1/agents`, { headers: { authorization: 'Bearer discovery-token-12345' } })).status).toBe(200)
    } finally {
      await new Promise<void>((resolveClose, reject) => {
        server.close((error) => { if (error === undefined) resolveClose(); else reject(error) })
      })
      await registry.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})
