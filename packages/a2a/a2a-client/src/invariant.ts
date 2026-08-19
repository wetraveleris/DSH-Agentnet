/** Package-owned invariant companion for the A2A SDK provider. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-a2a-client'
export const name = 'a2a-client-invariant'
export const inject = ['invariants']
/** No runtime invariant: transport state is owned by the configured provider and remote Agent. */
const install: InvariantInstaller = () => {}
/** Register the package-owned invariant companion. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
