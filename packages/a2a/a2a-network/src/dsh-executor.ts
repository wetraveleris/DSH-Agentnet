/** Cordis adapter that executes inbound A2A tasks through the local DSH loop. */

import { readFile } from 'node:fs/promises'
import { Context } from '@deepseek-ai/cordis'
import type z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { AgentOptions } from '@deepseek-ai/dsh-agent'
import type { GatewayTaskExecutor, GatewaySkill } from '@deepseek-ai/dsh-a2a-gateway'
import { startNode, type NodeConfig, type NodeHandle } from './node.ts'

/** Configuration for the DSH-backed node plugin. */
export interface DshNodePluginConfig extends Omit<NodeConfig, 'gateway' | 'relayToken'> {
  /** Enables the node after required endpoint and credential settings exist. */
  readonly enabled?: boolean
  /** Composition-only token; settings use `relayTokenRef` instead. */
  readonly relayToken?: string
  /** Credential reference for the Relay join token. */
  readonly relayTokenRef?: string
  /** Credential reference for Registry registration. */
  readonly registryTokenRef?: string
  /** Local provider route; omitted uses the configured default model. */
  readonly provider?: string
  /** Local model id; omitted uses the configured default model. */
  readonly model?: string
  /** Agent Card name. */
  readonly name: string
  /** Agent Card description. */
  readonly description: string
  /** Public skills exposed by this node. */
  readonly skills: readonly GatewaySkill[]
}

interface DefaultModelService {
  currentSelection(): { readonly provider: string; readonly model: string }
}

function answerText(agent: { readonly session: { readonly events: readonly { type: string; data: unknown }[] } }): string {
  let result = ''
  for (const event of agent.session.events) {
    if (event.type !== 'assistant/message') continue
    const data = event.data as { message?: { content?: readonly { type: string; text?: string }[] } }
    const text = data.message?.content?.filter(block => block.type === 'text').map(block => block.text ?? '').join('') ?? ''
    if (text !== '') result = text
  }
  return result || 'The local Agent completed without a text response.'
}

/** Build an executor which submits one inbound task to the local DSH Agent Loop.
 * @param ctx - Cordis context providing Agents, attachments, credentials, and the default model.
 * @param config - optional provider and model override.
 * @returns an executor that returns the local Agent's final text.
 */
export function createDshTaskExecutor(ctx: Context, config: Pick<DshNodePluginConfig, 'provider' | 'model'>): GatewayTaskExecutor {
  return async (input, signal) => {
    const defaultModel = ctx.get('agentDefaultModel') as DefaultModelService | undefined
    const selection = defaultModel?.currentSelection()
    const provider = config.provider ?? selection?.provider
    const model = config.model ?? selection?.model
    const options: AgentOptions = {
      ...(provider === undefined ? {} : { provider }),
      ...(model === undefined ? {} : { model }),
    }
    const handle = await ctx.agents.create({
      sessionId: SessionId(`a2a-${input.taskId}`),
      meta: { cwd: process.cwd() },
      agentOptions: options,
    })
    try {
      signal.addEventListener('abort', () => { handle.agent.cancel({ kind: 'user' }) }, { once: true })
      const content: Array<{ type: 'text'; text: string } | { type: 'image'; attachment: Awaited<ReturnType<typeof ctx.attachments.saveImage>> }> = [{ type: 'text', text: input.instruction }]
      for (const attachment of input.attachments) {
        if (attachment.mediaType.startsWith('image/')) {
          const data = await readFile(attachment.path)
          const ref = await ctx.attachments.saveImage({ data, mediaType: attachment.mediaType as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif', name: attachment.name })
          content.push({ type: 'image', attachment: ref })
        } else {
          content.push({ type: 'text', text: `\nAttachment: ${attachment.name} (${attachment.mediaType}, ${attachment.byteLength} bytes)` })
        }
      }
      handle.agent.followup(createUserMessage({ content, source: { kind: 'user' } }))
      await handle.agent.whenIdle()
      if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('A2A task aborted')
      return answerText(handle.agent)
    } finally {
      await handle.dispose()
    }
  }
}

/** Start an outbound node owned by the Cordis plugin lifecycle.
 * @param ctx - Cordis context owning the node and its Agent resources.
 * @param config - node identity, Relay, registry, model, and skill settings.
 * @param schema - settings schema owned by the plugin entry.
 */
export function applyDshNode(ctx: Context, config: DshNodePluginConfig, schema: z<DshNodePluginConfig>): void {
  let node: NodeHandle | undefined
  let source = (): DshNodePluginConfig => config
  let generation = 0
  const stop = async (): Promise<void> => { const current = node; node = undefined; await current?.close() }
  const sync = async (): Promise<void> => {
    const currentGeneration = ++generation
    const current = source()
    if (current.enabled !== true) { await stop(); return }
    const credential = ctx.get('credentials')
    const relayToken = current.relayToken ?? (current.relayTokenRef === undefined || credential === undefined
      ? undefined
      : (await credential.resolve(credentialRef(current.relayTokenRef)))?.value)
    if (relayToken === undefined || currentGeneration !== generation) { await stop(); return }
    const registryToken = current.registryToken ?? (current.registryTokenRef === undefined || credential === undefined
      ? undefined
      : (await credential.resolve(credentialRef(current.registryTokenRef)))?.value)
    await stop()
    const candidate = await startNode({
      ...current,
      relayToken,
      ...(registryToken === undefined ? {} : { registryToken }),
      gateway: {
        name: current.name,
        description: current.description,
        skills: current.skills,
        executor: createDshTaskExecutor(ctx, current),
      },
    }).catch((error: unknown) => {
      ctx.logger.error(`a2a node failed to start: ${String(error)}`)
      return undefined
    })
    if (candidate === undefined) return
    if (currentGeneration !== generation) { await candidate.close(); return }
    node = candidate
  }
  installSettingsSection(ctx, settingsNamespace('a2a-node'), schema, config, {
    setSource: (current) => { source = current },
    onChange: () => { void sync() },
  })
  ctx.on('credentials/updated', (ref) => {
    const current = source()
    if (ref === current.relayTokenRef || ref === current.registryTokenRef) void sync()
  })
  ctx.effect(() => () => { ++generation; void stop() }, 'a2a-node.lifecycle()')
}
