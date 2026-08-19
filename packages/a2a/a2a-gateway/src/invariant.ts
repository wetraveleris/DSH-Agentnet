/** Package-owned invariant companion for the reference A2A Gateway. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-a2a-gateway'
export const name = 'a2a-gateway-invariant'
export const inject = ['invariants']
/** No runtime invariant: the reference server owns its state outside a Cordis agent context. */
const install: InvariantInstaller = () => {}
/** Register the package-owned invariant companion. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
