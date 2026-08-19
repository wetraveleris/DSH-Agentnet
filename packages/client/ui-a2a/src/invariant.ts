/** Package-owned invariant companion for the browser A2A settings contribution. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-a2a'
export const name = 'client-ui-a2a-invariant'
export const inject = ['invariants']
/** No runtime invariant: browser settings are a projection over Host-owned remote state. */
const install: InvariantInstaller = () => {}
/** Register the package-owned invariant companion. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
