/** Model-facing A2A discovery, direct-upload, and task tools. @module @deepseek-ai/dsh-tool-a2a */

import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import {
  type A2AAgentId,
  type A2AAttachmentRef,
  type A2AService,
  type A2ATaskId,
  type A2ATaskView,
} from '@deepseek-ai/dsh-a2a'
import type {} from '@deepseek-ai/dsh-fs'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'tool-a2a'
export const inject = ['tools', 'a2a', 'fs', 'systemPrompt']

function asAgentId(value: string): A2AAgentId { return value as A2AAgentId }

function renderJson(_args: unknown, value: JsonValue) {
  return [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }]
}

function taskJson(value: A2ATaskView): JsonValue {
  return value as unknown as JsonValue
}

async function uploadFiles(
  ctx: Context,
  a2a: A2AService,
  agentId: A2AAgentId,
  files: readonly { path: string; mediaType?: string }[],
  signal: AbortSignal,
): Promise<readonly A2AAttachmentRef[]> {
  const refs: A2AAttachmentRef[] = []
  for (const file of files) {
    const target = await ctx.fs.resolve(file.path, { signal })
    const info = await ctx.fs.stat(target, signal)
    if (info?.type !== 'file') throw new Error(`a2a_call: ${file.path} is not a regular file`)
    const bytes = await ctx.fs.readBytes(target, signal, a2a.maxUploadBytes())
    const sha256 = createHash('sha256').update(bytes).digest('hex') as A2AAttachmentRef['sha256']
    const ticket = await a2a.prepareUpload({
      agentId,
      name: file.path.split(/[\\/]/).pop() ?? file.path,
      mediaType: file.mediaType ?? 'text/plain',
      byteLength: bytes.byteLength,
      sha256,
    }, signal)
    await a2a.upload(ticket, bytes, signal)
    refs.push({
      attachmentId: ticket.attachmentId,
      name: ticket.name,
      mediaType: ticket.mediaType,
      byteLength: ticket.byteLength,
      sha256: ticket.sha256,
    })
  }
  return refs
}

/** Register the opt-in A2A tool set. */
export function apply(ctx: Context): void {
  const a2a = ctx.a2a
  ctx.systemPrompt.section({
    name: 'tool:a2a',
    order: 116,
    text: 'A2A tools call configured remote Agents through the standard A2A Protocol. Call a2a_discover before choosing a skill. For local files, pass file paths to a2a_call: the tool reads through ctx.fs, verifies SHA-256, uploads bytes to the remote Agent’s one-use direct-upload ticket, and sends only the opaque attachment reference in the A2A message. Do not put file contents or credentials in prompts.',
  })

  ctx.tools.register(defineTool({
    name: 'a2a_discover',
    description: 'Read the standard Agent Card for one configured remote Agent. Use the returned skill ids, input modes, output modes, and direct-upload capability to decide whether the Agent can handle the task.',
    parameters: {
      agentId: { type: 'string', description: 'Configured or previously discovered Agent id.' },
      skill: { type: 'string', description: 'Optional skill id. When agentId is omitted, search the configured public Registry.' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    async execute(args, exec) {
      if (args.agentId === undefined) return a2a.searchAgents(args.skill, exec.signal) as unknown as Promise<JsonValue>
      return a2a.discover(asAgentId(args.agentId), exec.signal) as unknown as Promise<JsonValue>
    },
  }))

  ctx.tools.register(defineTool({
    name: 'a2a_call',
    description: 'Send a task to a configured remote Agent using A2A. Optional files are uploaded directly to that Agent before the message is sent; file paths must be local files in the current DSH filesystem and mediaType should be supplied for non-text files.',
    parameters: {
      agentId: { type: 'string', required: true, description: 'Configured Agent id returned by a2a_discover.' },
      prompt: { type: 'string', required: true, description: 'Task instruction for the remote Agent.' },
      taskId: { type: 'string', description: 'Existing A2A task id for a follow-up message.' },
      files: {
        type: 'array',
        description: 'Optional local files to upload directly to the remote Agent.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            path: { type: 'string', required: true, description: 'Local path resolved by ctx.fs.' },
            mediaType: { type: 'string', description: 'MIME type, default text/plain.' },
          },
        },
      },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    async execute(args, exec) {
      const attachments = args.files === undefined ? [] : await uploadFiles(ctx, a2a, asAgentId(args.agentId), args.files, exec.signal)
      const result = await a2a.send({
        agentId: asAgentId(args.agentId), prompt: args.prompt,
        ...(args.taskId === undefined ? {} : { taskId: args.taskId as A2ATaskId }),
        ...(attachments.length === 0 ? {} : { attachments }),
      }, exec.signal)
      return taskJson(result)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'a2a_task',
    description: 'Read the latest standard A2A Task state, history, and artifacts for a previously returned task id.',
    parameters: {
      agentId: { type: 'string', required: true, description: 'Configured Agent id.' },
      taskId: { type: 'string', required: true, description: 'A2A task id returned by a2a_call.' },
      historyLength: { type: 'number', description: 'Maximum recent messages to request.' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    async execute(args, exec) {
      return taskJson(await a2a.getTask({
        agentId: asAgentId(args.agentId), taskId: args.taskId as A2ATaskId,
        ...(args.historyLength === undefined ? {} : { historyLength: args.historyLength }),
      }, exec.signal))
    },
  }))
}
