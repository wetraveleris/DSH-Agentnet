/** Browser settings contribution for the A2A capability. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import a2aRemote from '@deepseek-ai/dsh-a2a-client/remote'
import type {} from '@deepseek-ai/dsh-a2a-client/remote'
import { A2ASettingsSection } from './A2ASettingsSection.tsx'
import { en, zh } from './locales.ts'
import type { A2ARemoteApi } from './remote-api.ts'

const NS = 'a2a'
export const inject = ['slots', 'locale', 'remote', 'settingsScope', 'connection']

/** Mount the generated A2A Remote and contribute one settings section. */
export async function apply(ctx: ClientContext): Promise<void> {
  const disposeRemote = await ctx.remote.$mount(a2aRemote)
  ctx.effect(() => async () => { await disposeRemote() }, 'ui-a2a: remote')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-a2a: dictionaries')
  const t = ctx.locale.bind(NS)
  const nodeSettings = ctx.settingsScope.bind<Record<string, unknown>>({ namespace: 'a2a-node' })
  const hostApi = (ctx.get('connection') as ConnectionHandle).api
  ctx.inject(['remote.a2a'], (scope: ClientContext) => {
    const api = (scope.remote as unknown as { a2a: A2ARemoteApi }).a2a
    scope.slots.inject('settings.section', () => scope.slots.register({
      name: 'settings.section', id: 'a2a', order: 25, label: () => t('nav'), locale: NS,
      inject: () => ({ api, nodeSettings, hostApi }),
    }, A2ASettingsSection))
  })
}
