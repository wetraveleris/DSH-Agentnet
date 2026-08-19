/** Package-owned invariant companion for the A2A model tools. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-a2a'
export const name = 'tool-a2a-invariant'
export const inject = ['invariants']
/** No runtime invariant: tool calls delegate state and integrity checks to the A2A service. */
const install: InvariantInstaller = () => {}
/** Register the package-owned invariant companion. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
