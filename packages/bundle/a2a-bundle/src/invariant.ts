/** Package-owned invariant companion for the optional A2A profile bundle. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-a2a-bundle'
export const name = 'a2a-bundle-invariant'
export const inject = ['invariants']
/** No runtime invariant: the patch carrier owns no runtime state. */
const install: InvariantInstaller = () => {}
/** Register the package-owned invariant companion. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
