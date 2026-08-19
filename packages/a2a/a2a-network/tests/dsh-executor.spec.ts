import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { createDshTaskExecutor } from '../src/dsh-executor.ts'

describe('DSH A2A executor', () => {
  it('submits remote instruction and images to the local Agent Loop', async () => {
    const path = join(tmpdir(), `dsh-a2a-executor-${crypto.randomUUID()}.png`)
    const image = Buffer.from('png-fixture')
    await import('node:fs/promises').then(fs => fs.writeFile(path, image))
    let submitted: UserMessage | undefined
    const followup = vi.fn((message: UserMessage) => { submitted = message })
    const dispose = vi.fn(async () => undefined)
    const fakeAgent = {
      followup,
      whenIdle: vi.fn(async () => undefined),
      cancel: vi.fn(),
      session: { events: [{ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'vision result' }] } } }] },
    }
    const saveImage = vi.fn(async ({ data, mediaType, name }: { data: Uint8Array; mediaType: string; name?: string }) => ({ attachmentId: 'sha256:test', mediaType, bytes: data.byteLength, width: 1, height: 1, ...(name === undefined ? {} : { name }) }))
    const ctx = {
      get: vi.fn(() => undefined),
      agents: { create: vi.fn(async () => ({ agent: fakeAgent, dispose })) },
      attachments: { saveImage },
    } as unknown as Context
    const execute = createDshTaskExecutor(ctx, {})
    await expect(execute({ taskId: 'task', contextId: 'context', instruction: 'describe it', attachments: [{ id: 'upload', name: 'photo.png', mediaType: 'image/png', byteLength: image.byteLength, sha256: '0'.repeat(64), path }] }, new AbortController().signal)).resolves.toBe('vision result')
    expect(followup).toHaveBeenCalledOnce()
    expect(submitted?.content).toHaveLength(2)
    const saved = saveImage.mock.calls[0]?.[0]
    expect(saved?.data).toBeInstanceOf(Uint8Array)
    expect(saved?.mediaType).toBe('image/png')
    expect(saved?.name).toBe('photo.png')
    expect(dispose).toHaveBeenCalledOnce()
    await import('node:fs/promises').then(fs => fs.rm(path, { force: true }))
  })
})
