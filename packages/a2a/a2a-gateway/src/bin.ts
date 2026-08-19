/** CLI entry point for the reference A2A Gateway. @module @deepseek-ai/dsh-a2a-gateway/bin */

import { startGateway } from './index.ts'

const port = Number.parseInt(process.env.DSH_A2A_PORT ?? '18090', 10)
const host = process.env.DSH_A2A_HOST ?? '0.0.0.0'
const publicUrl = process.env.DSH_A2A_PUBLIC_URL ?? `http://127.0.0.1:${String(port)}`
const agentId = process.env.DSH_A2A_AGENT_ID ?? 'gateway'

if (!Number.isSafeInteger(port) || port < 0 || port > 65535) {
  throw new Error('DSH_A2A_PORT must be a valid TCP port or 0')
}

const gateway = await startGateway({ agentId, host, port, publicUrl })
const stop = async (): Promise<void> => {
  await gateway.close()
}
process.once('SIGINT', () => { void stop() })
process.once('SIGTERM', () => { void stop() })
