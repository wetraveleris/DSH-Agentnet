import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ToolA2A from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('A2A tool real Loader composition', () => {
  it('mounts the provider, model tools, and system guidance from cordis.yml', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-a2a-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      '- name: test-a2a-provider',
      "- name: '@deepseek-ai/dsh-system-prompt'",
      "- name: '@deepseek-ai/dsh-tools'",
      "- name: '@deepseek-ai/dsh-tool-a2a'",
      '',
    ].join('\n'))

    const provider = {
      name: 'test-a2a-provider',
      apply(ctx: Context): void {
        ctx.provide('a2a', {
          listAgents: () => [],
          searchAgents: async () => [],
          maxUploadBytes: () => 1024,
          discover: async () => { throw new Error('not used') },
          prepareUpload: async () => { throw new Error('not used') },
          upload: async () => { throw new Error('not used') },
          send: async () => { throw new Error('not used') },
          getTask: async () => { throw new Error('not used') },
        } as never)
        ctx.provide('fs', {} as never)
      },
    }

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['test-a2a-provider', provider],
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-tools', ToolRuntime],
      ['@deepseek-ai/dsh-tool-a2a', ToolA2A],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        const module = modules.get(specifier)
        if (module === undefined) throw new Error(`unexpected Loader import: ${specifier}`)
        return module
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await context.loader.await()

    expect([...context.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)).toEqual([])
    expect(context.tools.schemas().map(schema => schema.name).sort()).toEqual(['a2a_call', 'a2a_discover', 'a2a_task'])
    expect((await context.systemPrompt.assemble()).sections.map(section => section.name)).toContain('tool:a2a')
  })

  it('uploads raw filesystem bytes without text decoding', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-a2a-bytes-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      '- name: test-a2a-provider',
      "- name: '@deepseek-ai/dsh-system-prompt'",
      "- name: '@deepseek-ai/dsh-tools'",
      "- name: '@deepseek-ai/dsh-tool-a2a'",
      '',
    ].join('\n'))

    const original = Uint8Array.from([0, 255, 10, 128, 42])
    let uploaded: Uint8Array | undefined
    const provider = {
      name: 'test-a2a-provider',
      apply(ctx: Context): void {
        ctx.provide('a2a', {
          listAgents: () => [],
          maxUploadBytes: () => 1024,
          discover: async () => { throw new Error('not used') },
          prepareUpload: async (request: { readonly agentId: string; readonly name: string; readonly mediaType: string; readonly byteLength: number; readonly sha256: string }) => ({ ...request, attachmentId: 'attachment-1', uploadUrl: 'https://example.test/upload', token: 'token', expiresAt: Date.now() + 10_000 } as never),
          upload: async (_ticket: unknown, bytes: Uint8Array) => { uploaded = bytes },
          send: async (request: { readonly agentId: string }) => ({ agentId: request.agentId, taskId: 'task-1', state: 'completed', messages: [], artifacts: [] } as never),
          getTask: async () => { throw new Error('not used') },
        } as never)
        ctx.provide('fs', {
          resolve: async () => ({ targetKey: 'file:test', displayPath: 'image.bin' }),
          stat: async () => ({ type: 'file' }),
          readBytes: async () => original,
        } as never)
      },
    }

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['test-a2a-provider', provider],
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-tools', ToolRuntime],
      ['@deepseek-ai/dsh-tool-a2a', ToolA2A],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        const module = modules.get(specifier)
        if (module === undefined) throw new Error(`unexpected Loader import: ${specifier}`)
        return module
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await context.loader.await()

    const result = await context.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('binary-upload'), name: 'a2a_call',
      arguments: { agentId: 'lab', prompt: 'inspect image', files: [{ path: 'image.bin', mediaType: 'image/png' }] },
    })
    expect(result.isError).toBe(false)
    expect(uploaded).toEqual(original)
  })
})
