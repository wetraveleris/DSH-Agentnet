/** CLI entry point for the public A2A Agent registry. @module @deepseek-ai/dsh-a2a-registry/bin */

import { startRegistry } from './index.ts'

const port = Number.parseInt(process.env.DSH_A2A_REGISTRY_PORT ?? '18100', 10)
const host = process.env.DSH_A2A_REGISTRY_HOST ?? '127.0.0.1'
const publicUrl = process.env.DSH_A2A_REGISTRY_PUBLIC_URL
const dataFile = process.env.DSH_A2A_REGISTRY_DATA ?? './.dsh-a2a/registry.json'
const registrationToken = process.env.DSH_A2A_REGISTRY_TOKEN ?? ''
const discoveryToken = process.env.DSH_A2A_REGISTRY_DISCOVERY_TOKEN

if (registrationToken.length < 16) throw new Error('DSH_A2A_REGISTRY_TOKEN must contain at least 16 characters')
if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error('DSH_A2A_REGISTRY_PORT must be a valid TCP port or 0')

const registry = await startRegistry({
  host,
  port,
  dataFile,
  registrationToken,
  ...(publicUrl === undefined ? {} : { publicUrl }),
  ...(discoveryToken === undefined ? {} : { discoveryToken }),
})
console.log(`dsh-a2a-registry: ${publicUrl ?? `http://${host}:${String(registry.config.port)}`}`)

const stop = (): void => { void registry.close().then(() => process.exit(0)) }
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
