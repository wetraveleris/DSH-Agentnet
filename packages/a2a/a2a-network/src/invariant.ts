/** Package-owned invariant companion for the public A2A Relay and node runtime. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-a2a-network'
export const name = 'a2a-network-invariant'
export const inject = ['invariants']
/** No runtime invariant: Relay sockets and node leases are owned by process handles, not Cordis agents. */
const install: InvariantInstaller = () => {}
/** Register the package-owned invariant companion. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
