import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { A2AClientService } from '@deepseek-ai/dsh-a2a-client'
import { startNode } from '../src/node.ts'
import { startRelay } from '../src/relay.ts'

const TOKEN = 'relay-node-test-token-12345'

describe('A2A public node network', () => {
  it('keeps the node outbound while relaying Agent Card, uploads, and A2A tasks', async () => {
    const relay = await startRelay({ publicUrl: 'http://127.0.0.1', host: '127.0.0.1', port: 0, joinToken: TOKEN })
    const node = await startNode({
      agentId: 'b-vision',
      relayUrl: relay.publicUrl,
      relayToken: TOKEN,
      gateway: {
        name: 'B Vision Node',
        description: 'Vision test peer',
        skills: [{ id: 'image-analysis', name: 'Image analysis', description: 'Analyzes an uploaded image.', inputModes: ['image/png'], outputModes: ['text/plain'] }],
        executor: async ({ instruction, attachments }) => `B executed ${instruction} on ${attachments.map(item => `${item.name}:${item.mediaType}`).join(',')}`,
      },
    })
    try {
      const card = await fetch(`${relay.publicUrl}/agents/b-vision/.well-known/agent-card.json`)
      expect(card.status).toBe(200)
      await expect(card.json()).resolves.toMatchObject({ name: 'B Vision Node', skills: [{ id: 'image-analysis' }] })

      const bytes = Buffer.from('image-bytes')
      const ticketResponse = await fetch(`${relay.publicUrl}/agents/b-vision/dsh/uploads`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'photo.png', mediaType: 'image/png', byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') }),
      })
      expect(ticketResponse.status).toBe(201)
      const ticket = await ticketResponse.json() as { uploadUrl: string; token: string; attachmentId: string }
      expect(await fetch(ticket.uploadUrl.replace(relay.publicUrl, relay.publicUrl), { method: 'PUT', headers: { 'x-dsh-a2a-upload-token': ticket.token, 'content-type': 'image/png' }, body: bytes })).toMatchObject({ status: 204 })

      const task = await fetch(`${relay.publicUrl}/agents/b-vision/a2a/message:send`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'a2a-version': '1.0' },
        body: JSON.stringify({
          message: {
            messageId: 'public-message-1', contextId: 'public-context-1', taskId: '', role: 'ROLE_USER', parts: [{ text: 'describe this image' }],
            metadata: { 'https://deepseek.com/a2a/extensions/direct-upload/v1': { attachments: [{ attachmentId: ticket.attachmentId, name: 'photo.png', byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') }] } },
          },
          configuration: { acceptedOutputModes: ['text/plain'], returnImmediately: true },
        }),
      })
      expect(task.status).toBe(200)
      const created = await task.json() as { task: { id: string } }
      const result = await fetch(`${relay.publicUrl}/agents/b-vision/a2a/tasks/${created.task.id}?historyLength=20`, { headers: { 'a2a-version': '1.0' } })
      expect(result.status).toBe(200)
      await expect(result.json()).resolves.toMatchObject({ status: { state: 'TASK_STATE_COMPLETED' }, artifacts: [{ parts: [{ text: 'B executed describe this image on photo.png:image/png' }] }] })
    } finally {
      await node.close()
      await relay.close()
    }
  })

  it('supports the official SDK client through the public Relay', async () => {
    const relay = await startRelay({ publicUrl: 'http://127.0.0.1', host: '127.0.0.1', port: 0, joinToken: TOKEN })
    const node = await startNode({
      agentId: 'sdk-peer',
      relayUrl: relay.publicUrl,
      relayToken: TOKEN,
      gateway: {
        name: 'SDK peer',
        description: 'Official SDK integration peer',
        skills: [{ id: 'image-analysis', name: 'Image analysis', description: 'Analyzes an uploaded image.', inputModes: ['image/png'], outputModes: ['text/plain'] }],
        executor: async ({ instruction, attachments }) => `SDK executed ${instruction} on ${attachments.map(item => item.name).join(',')}`,
      },
    })
    const context = new Context()
    try {
      const client = new A2AClientService(context, {
        agents: {
          'sdk-peer': {
            endpoint: `${relay.publicUrl}/agents/sdk-peer`,
            cardUrl: `${relay.publicUrl}/agents/sdk-peer/.well-known/agent-card.json`,
            uploadUrl: `${relay.publicUrl}/agents/sdk-peer/dsh/uploads`,
          },
        },
        allowInsecureHttp: true,
        requestTimeoutMs: 5_000,
        maxUploadBytes: 1024,
      })
      await expect(client.discover('sdk-peer' as never)).resolves.toMatchObject({ name: 'SDK peer', skills: [{ id: 'image-analysis' }] })

      const bytes = new TextEncoder().encode('sdk-image')
      const ticket = await client.prepareUpload({
        agentId: 'sdk-peer' as never,
        name: 'photo.png',
        mediaType: 'image/png',
        byteLength: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex') as never,
      })
      await client.upload(ticket, bytes)
      const initial = await client.send({
        agentId: 'sdk-peer' as never,
        prompt: 'describe this image',
        attachments: [{
          attachmentId: ticket.attachmentId,
          name: ticket.name,
          mediaType: ticket.mediaType,
          byteLength: ticket.byteLength,
          sha256: ticket.sha256,
        }],
      })
      expect(initial.kind).toBe('task')
      const taskId = initial.taskId
      if (taskId === undefined) throw new Error('SDK did not return a task id')
      const result = await client.getTask({ agentId: 'sdk-peer' as never, taskId })
      expect(result.state).toBe('TASK_STATE_COMPLETED')
      expect(result.text).toContain('SDK executed describe this image on photo.png')
    } finally {
      await context.fiber.dispose()
      await node.close()
      await relay.close()
    }
  })

  it('rejects public calls until a node opens an outbound tunnel', async () => {
    const relay = await startRelay({ publicUrl: 'http://127.0.0.1', host: '127.0.0.1', port: 0, joinToken: TOKEN })
    try {
      const response = await fetch(`${relay.publicUrl}/agents/offline/.well-known/agent-card.json`)
      expect(response.status).toBe(503)
    } finally {
      await relay.close()
    }
  })

  it('reconnects a node tunnel after an unexpected close', async () => {
    const relay = await startRelay({ publicUrl: 'http://127.0.0.1', host: '127.0.0.1', port: 0, joinToken: TOKEN })
    const node = await startNode({
      agentId: 'reconnect-peer', relayUrl: relay.publicUrl, relayToken: TOKEN, reconnectMs: 10, maxReconnectMs: 30,
      gateway: { name: 'Reconnect peer', description: 'reconnect test' },
    })
    try {
      node.socket.close(4000, 'test reconnect')
      await new Promise(resolve => setTimeout(resolve, 80))
      const card = await fetch(`${relay.publicUrl}/agents/reconnect-peer/.well-known/agent-card.json`)
      expect(card.status).toBe(200)
    } finally {
      await node.close()
      await relay.close()
    }
  })
})
