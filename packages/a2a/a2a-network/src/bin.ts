#!/usr/bin/env node
/** CLI dispatcher for the public Relay and outbound peer node. @module @deepseek-ai/dsh-a2a-network/bin */

import { basename } from 'node:path'
import type { GatewaySkill } from '@deepseek-ai/dsh-a2a-gateway'
import { startNode, type NodeConfig } from './node.ts'
import { startRelay } from './relay.ts'

function required(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') throw new Error(`${name} is required`)
  return value
}

function parseJson<T>(name: string, fallback: T): T {
  const value = process.env[name]
  if (value === undefined || value === '') return fallback
  try { return JSON.parse(value) as T } catch (error) { throw new Error(`${name} must be valid JSON`, { cause: error }) }
}

async function runNode(): Promise<() => Promise<void>> {
  const skills = parseJson<readonly GatewaySkill[]>('DSH_A2A_SKILLS_JSON', [{
    id: 'echo-and-inspect',
    name: 'Echo and inspect',
    description: 'Accepts an instruction and reports uploaded attachment metadata.',
    tags: ['a2a', 'files'],
    inputModes: ['text/plain'],
    outputModes: ['text/plain'],
  }])
  const config: NodeConfig = {
    agentId: required('DSH_A2A_AGENT_ID'),
    relayUrl: required('DSH_A2A_RELAY_URL'),
    relayToken: required('DSH_A2A_RELAY_TOKEN'),
    ...(process.env.DSH_A2A_REGISTRY_URL === undefined ? {} : { registryUrl: process.env.DSH_A2A_REGISTRY_URL }),
    ...(process.env.DSH_A2A_REGISTRY_TOKEN === undefined ? {} : { registryToken: process.env.DSH_A2A_REGISTRY_TOKEN }),
    gateway: {
      name: process.env.DSH_A2A_AGENT_NAME ?? 'DSH A2A Peer',
      description: process.env.DSH_A2A_AGENT_DESCRIPTION ?? 'A DSH peer node',
      skills,
    },
  }
  const node = await startNode(config)
  console.log(`dsh-a2a-node: connected as ${config.agentId}`)
  return node.close
}

async function runRelay(): Promise<() => Promise<void>> {
  const relay = await startRelay({
    publicUrl: required('DSH_A2A_RELAY_PUBLIC_URL'),
    joinToken: required('DSH_A2A_RELAY_JOIN_TOKEN'),
    ...(process.env.DSH_A2A_RELAY_ACCESS_TOKEN === undefined ? {} : { accessToken: process.env.DSH_A2A_RELAY_ACCESS_TOKEN }),
    host: process.env.DSH_A2A_RELAY_HOST ?? '127.0.0.1',
    port: Number.parseInt(process.env.DSH_A2A_RELAY_PORT ?? '18080', 10),
  })
  console.log(`dsh-a2a-relay: listening at ${relay.publicUrl}`)
  return relay.close
}

const command = basename(process.argv[1] ?? '')
const isRelay = command.includes('relay') || process.env.DSH_A2A_RELAY_PUBLIC_URL !== undefined
const isNode = command.includes('node') || process.env.DSH_A2A_AGENT_ID !== undefined
const close = isRelay && !isNode ? await runRelay() : isNode && !isRelay ? await runNode() : undefined
if (close === undefined) throw new Error('invoke this entry as dsh-a2a-relay or dsh-a2a-node')
const stop = (): void => { void close().then(() => process.exit(0)) }
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
