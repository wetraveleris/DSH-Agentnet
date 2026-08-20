/** Public reverse Relay and outbound A2A node runtime. @module @deepseek-ai/dsh-a2a-network */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { applyDshNode } from './dsh-executor.ts'
import type { DshNodePluginConfig } from './dsh-executor.ts'

export { startNode, type NodeConfig, type NodeHandle } from './node.ts'
export { startRelay, type RelayConfig, type RelayHandle } from './relay.ts'
export { applyDshNode, createDshTaskExecutor, type DshNodePluginConfig } from './dsh-executor.ts'

/** Cordis loader schema for a DSH-backed node. */
export const Config: z<DshNodePluginConfig> = z.object({
  enabled: z.boolean().default(false),
  agentId: z.string(), relayUrl: z.string(), relayToken: z.string(), relayTokenRef: z.string(),
  registryUrl: z.string(), registryToken: z.string(), registryTokenRef: z.string(), provider: z.string(), model: z.string(),
  name: z.string().default('DSH A2A peer'), description: z.string().default('A DSH peer node'),
  skills: z.array(z.object({
    id: z.string().required(), name: z.string().required(), description: z.string().required(),
    tags: z.array(z.string()), examples: z.array(z.string()), inputModes: z.array(z.string()), outputModes: z.array(z.string()),
  })).default([{
    id: 'echo-and-inspect', name: 'Echo and inspect', description: 'Accepts text and reports attachment metadata.',
    tags: ['a2a'], examples: [], inputModes: ['text/plain'], outputModes: ['text/plain'],
  }]),
  heartbeatMs: z.number().step(1).min(1000), maxBodyBytes: z.number().step(1).min(1),
  reconnectMs: z.number().step(1).min(1), maxReconnectMs: z.number().step(1).min(1),
}) as unknown as z<DshNodePluginConfig>

/** Required core services for the DSH-backed node. */
export const inject = ['agents', 'attachments', 'credentials']

/** Mount an outbound A2A node through the DSH Agent Loop.
 * @param ctx - Cordis context owning the node.
 * @param config - node identity, transport, model, and skills.
 */
export function apply(ctx: Context, config: DshNodePluginConfig): void {
  applyDshNode(ctx, config, Config)
}

export const name = 'a2a-node'
