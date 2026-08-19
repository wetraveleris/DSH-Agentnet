/** Package-owned invariant companion for the A2A service definition. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-a2a'
export const name = 'a2a-invariant'
export const inject = ['invariants']
/** No runtime invariant: this package only declares the capability vocabulary. */
const install: InvariantInstaller = () => {}
/** Register the package-owned invariant companion. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
