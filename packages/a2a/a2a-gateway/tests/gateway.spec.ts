import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { createGateway } from '../src/index.ts'

const DIGEST = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'

interface RunningGateway {
  readonly server: Server
  readonly root: string
  readonly close: () => Promise<void>
  readonly url: string
}

async function running(config: { readonly agentId?: string } = {}): Promise<RunningGateway> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-a2a-gateway-'))
  const gateway = await createGateway({ ...config, host: '127.0.0.1', port: 0, publicUrl: 'http://127.0.0.1', uploadRoot: root })
  const server = await new Promise<Server>((resolve, reject) => {
    const value = gateway.app.listen(0, '127.0.0.1', () => { resolve(value) })
    value.once('error', reject)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('test gateway did not expose a TCP address')
  const url = `http://127.0.0.1:${String(address.port)}`
  return {
    server,
    root: gateway.config.uploadRoot,
    url,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => { if (error === undefined) resolve(); else reject(error) })
      })
      await gateway.close()
      await rm(root, { recursive: true, force: true })
    },
  }
}

let active: RunningGateway | undefined

afterEach(async () => {
  await active?.close()
  active = undefined
})

describe('A2A gateway', () => {
  it('publishes an Agent Card with the direct-upload extension', async () => {
    active = await running()
    const response = await fetch(`${active.url}/.well-known/agent-card.json`)
    expect(response.status).toBe(200)
    const card = await response.json() as {
      supportedInterfaces: { protocolVersion: string }[]
      capabilities: { extensions: { uri: string }[] }
    }
    expect(card.supportedInterfaces[0]?.protocolVersion).toBe('1.0')
    expect(card.capabilities.extensions).toContainEqual(expect.objectContaining({ uri: 'https://deepseek.com/a2a/extensions/direct-upload/v1' }))
  })

  it('enforces one-use upload tickets and returns completed A2A tasks', async () => {
    active = await running()
    const ticketResponse = await fetch(`${active.url}/dsh/uploads`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'hello.txt', mediaType: 'text/plain', byteLength: 5, sha256: DIGEST }),
    })
    expect(ticketResponse.status).toBe(201)
    const ticket = await ticketResponse.json() as { attachmentId: string; uploadUrl: string; token: string }
    const uploadUrl = new URL(ticket.uploadUrl).pathname
    const localUploadUrl = `${active.url}${uploadUrl}`

    const rejected = await fetch(localUploadUrl, { method: 'PUT', headers: { 'x-dsh-a2a-upload-token': 'wrong' }, body: 'hello' })
    expect(rejected.status).toBe(401)
    const uploaded = await fetch(localUploadUrl, { method: 'PUT', headers: { 'x-dsh-a2a-upload-token': ticket.token, 'content-type': 'text/plain' }, body: 'hello' })
    expect(uploaded.status).toBe(204)
    const reused = await fetch(localUploadUrl, { method: 'PUT', headers: { 'x-dsh-a2a-upload-token': ticket.token }, body: 'hello' })
    expect(reused.status).toBe(401)

    const sent = await fetch(`${active.url}/a2a/message:send`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'a2a-version': '1.0' },
      body: JSON.stringify({
        message: {
          messageId: 'message-1', contextId: 'context-1', taskId: '', role: 'ROLE_USER',
          parts: [{ text: 'inspect the upload' }],
          metadata: { 'https://deepseek.com/a2a/extensions/direct-upload/v1': { attachments: [{ attachmentId: ticket.attachmentId, name: 'hello.txt', byteLength: 5, sha256: DIGEST }] } },
        },
        configuration: { acceptedOutputModes: ['text/plain'], returnImmediately: true },
      }),
    })
    expect(sent.status).toBe(200)
    const initial = await sent.json() as { task: { id: string } }
    const taskResponse = await fetch(`${active.url}/a2a/tasks/${initial.task.id}?historyLength=20`, { headers: { 'a2a-version': '1.0' } })
    expect(taskResponse.status).toBe(200)
    const task = await taskResponse.json() as { status: { state: string }; artifacts: { parts: { text?: string }[] }[] }
    expect(task.status.state).toBe('TASK_STATE_COMPLETED')
    expect(task.artifacts[0]?.parts[0]?.text).toContain('hello.txt (5 bytes')
    await expect(readFile(join(active.root, ticket.attachmentId, 'content'), 'utf8')).resolves.toBe('hello')
  })

  it('returns the configured Agent ID in upload tickets', async () => {
    active = await running({ agentId: 'lab' })
    const response = await fetch(`${active.url}/dsh/uploads`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'hello.txt', mediaType: 'text/plain', byteLength: 5, sha256: DIGEST }),
    })
    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({ agentId: 'lab' })
  })

  it('rejects malformed upload metadata before creating a directory', async () => {
    active = await running()
    const response = await fetch(`${active.url}/dsh/uploads`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'bad', mediaType: 'text/plain', byteLength: 1, sha256: 'not-a-digest' }),
    })
    expect(response.status).toBe(400)
  })

  it('does not remove a caller-owned upload parent during gateway cleanup', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'dsh-a2a-gateway-parent-'))
    const sentinel = join(parent, 'sentinel')
    await writeFile(sentinel, 'keep')
    const gateway = await createGateway({ publicUrl: 'http://127.0.0.1', uploadRoot: parent })
    await gateway.close()
    await expect(readFile(sentinel, 'utf8')).resolves.toBe('keep')
    await rm(parent, { recursive: true, force: true })
  })
})
