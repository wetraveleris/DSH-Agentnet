/** Package-owned invariant companion for the public A2A registry. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-a2a-registry'
export const name = 'a2a-registry-invariant'
export const inject = ['invariants']
/** No runtime invariant: registry leases are owned by the standalone HTTP service. */
const install: InvariantInstaller = () => {}
/** Register the package-owned invariant companion. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
