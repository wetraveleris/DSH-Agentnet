/** Agent network settings page backed by the mounted A2A Remote. */

import { useEffect, useMemo, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { A2AAgentCardView, A2AAgentView } from '@deepseek-ai/dsh-a2a'
import type { A2ARemoteApi, A2ARemoteResult } from './remote-api.ts'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import css from './A2ASettingsSection.module.css'

interface Injected { api: A2ARemoteApi; nodeSettings?: SettingsScope<Record<string, unknown>>; hostApi?: Pick<IApiClient, 'credentials'> }
type Props = PropsRuntime<'settings.section'> & PropsLocale<'a2a'> & InjectFace<Injected>

function errorOf<T>(result: A2ARemoteResult<T>): string | undefined {
  return result.ok ? undefined : result.error?.message ?? 'Remote request failed'
}

/** Render joined Agent discovery and capability metadata. */
export function A2ASettingsSection({ t, api, nodeSettings, hostApi }: Props) {
  const [agents, setAgents] = useState<readonly A2AAgentView[]>([])
  const [agentId, setAgentId] = useState('')
  const [skill, setSkill] = useState('')
  const [card, setCard] = useState<A2AAgentCardView>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [node, setNode] = useState<Record<string, unknown>>(() => nodeSettings?.getSnapshot().value ?? {})
  const [saving, setSaving] = useState(false)
  const [relaySecret, setRelaySecret] = useState('')
  const [registrySecret, setRegistrySecret] = useState('')
  const selected = useMemo(() => agents.find(agent => String(agent.id) === agentId), [agentId, agents])

  useEffect(() => {
    void api.list().then((value) => {
      const failure = errorOf(value)
      if (failure !== undefined) { setError(failure); return }
      const next = value.value ?? []
      setAgents(next)
      setAgentId(current => current || (next[0] === undefined ? '' : String(next[0].id)))
    }).catch((reason: unknown) => { setError(String(reason)) })
  }, [api])

  useEffect(() => {
    if (nodeSettings === undefined) return
    const sync = () => { setNode(nodeSettings.getSnapshot().value ?? {}) }
    sync()
    return nodeSettings.subscribe(sync)
  }, [nodeSettings])

  const field = (key: string): string => {
    const value = node[key]
    return typeof value === 'string' ? value : ''
  }
  const saveNode = async () => {
    if (nodeSettings === undefined) return
    setSaving(true); setError(undefined)
    try {
      const agentId = field('agentId').trim()
      const relayUrl = field('relayUrl').trim()
      if (agentId.length === 0 || relayUrl.length === 0) throw new Error(t('requiredJoinFields'))
      const parsedSkills: unknown = JSON.parse(field('skills') || '[]')
      if (!Array.isArray(parsedSkills)) throw new Error(t('invalidSkills'))
      const relayTokenRef = field('relayTokenRef').trim() || 'DSH_A2A_RELAY_TOKEN'
      const registryTokenRef = field('registryTokenRef').trim() || 'DSH_A2A_REGISTRY_TOKEN'
      if (relaySecret !== '' && hostApi !== undefined) {
        const saved = await hostApi.credentials.set({ ref: relayTokenRef, value: relaySecret })
        if (!saved.result.ok) throw new Error(saved.result.error.message)
      }
      if (registrySecret !== '' && hostApi !== undefined) {
        const saved = await hostApi.credentials.set({ ref: registryTokenRef, value: registrySecret })
        if (!saved.result.ok) throw new Error(saved.result.error.message)
      }
      await nodeSettings.set('enabled', false)
      for (const [key, value] of Object.entries({
        agentId, relayUrl, relayTokenRef, registryTokenRef,
        name: field('name').trim() || 'DSH A2A peer',
        description: field('description').trim() || 'A DSH peer node',
        skills: parsedSkills,
      })) await nodeSettings.set(key, value)
      for (const key of ['registryUrl', 'provider', 'model'] as const) {
        const value = field(key).trim()
        if (value === '') await nodeSettings.unset(key)
        else await nodeSettings.set(key, value)
      }
      await nodeSettings.set('enabled', true)
      setRelaySecret(''); setRegistrySecret('')
    } catch (reason: unknown) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setSaving(false) }
  }

  const discover = () => {
    if (agentId.length === 0) return
    setBusy(true); setError(undefined)
    void api.discover(agentId).then((value) => {
      const failure = errorOf(value)
      if (failure !== undefined) { setError(failure); return }
      setCard(value.value)
    }).catch((reason: unknown) => { setError(String(reason)) }).finally(() => { setBusy(false) })
  }

  const search = () => {
    setBusy(true); setError(undefined)
    void api.search(skill.trim() || undefined).then((value) => {
      const failure = errorOf(value)
      if (failure !== undefined) { setError(failure); return }
      const discovered = value.value ?? []
      setAgents((current) => {
        const merged = new Map(current.map(agent => [String(agent.id), agent]))
        for (const agent of discovered) merged.set(String(agent.id), agent)
        return [...merged.values()]
      })
      if (discovered[0] !== undefined) { setAgentId(String(discovered[0].id)); setCard(undefined) }
    }).catch((reason: unknown) => { setError(String(reason)) }).finally(() => { setBusy(false) })
  }

  return (
    <div className={css.section}>
      <h2 className={css.heading}>{t('title')}</h2>
      <p className={css.intro}>{t('intro')}</p>
      {nodeSettings !== undefined && <div className={css.card}>
        <div className={css.cardTitle}>{t('joinTitle')}</div>
        <p className={css.meta}>{t('joinIntro')}</p>
        {(['agentId', 'relayUrl', 'relayTokenRef', 'registryUrl', 'registryTokenRef', 'provider', 'model', 'name', 'description', 'skills'] as const).map(key => (
          <label className={css.field} key={key}><span className={css.label}>{t(key)}</span><input className={css.input} value={key === 'skills' && typeof node[key] !== 'string' ? JSON.stringify(node[key] ?? []) : field(key)} onChange={(event) => { setNode(current => ({ ...current, [key]: event.target.value })) }} /></label>
        ))}
        {hostApi !== undefined && <>
          <label className={css.field}><span className={css.label}>{t('relaySecret')}</span><input className={css.input} type="password" autoComplete="new-password" value={relaySecret} onChange={(event) => { setRelaySecret(event.target.value) }} /></label>
          <label className={css.field}><span className={css.label}>{t('registrySecret')}</span><input className={css.input} type="password" autoComplete="new-password" value={registrySecret} onChange={(event) => { setRegistrySecret(event.target.value) }} /></label>
        </>}
        <div className={css.row}>
          <button type="button" className={css.button} disabled={saving} onClick={() => { void saveNode() }}>{saving ? t('saving') : t('join')}</button>
          <button type="button" className={css.button} disabled={saving} onClick={() => { void nodeSettings.set('enabled', false) }}>{t('leave')}</button>
        </div>
      </div>}
      <div className={css.field}>
        <label className={css.label} htmlFor="a2a-agent">{t('agent')}</label>
        {agents.length === 0 ? <p className={css.empty}>{t('noAgents')}</p> : (
          <select id="a2a-agent" className={css.select} value={agentId} onChange={(event) => { setAgentId(event.target.value); setCard(undefined) }}>
            {agents.map(agent => <option key={String(agent.id)} value={String(agent.id)}>{String(agent.id)} · {agent.endpoint}</option>)}
          </select>
        )}
        {selected !== undefined && <span className={css.meta}>{selected.endpoint} · {selected.directUpload ? t('directUpload') : t('noDirectUpload')}</span>}
      </div>
      <div className={css.field}>
        <label className={css.label} htmlFor="a2a-skill">{t('skillSearch')}</label>
        <div className={css.searchRow}>
          <input id="a2a-skill" className={css.input} value={skill} placeholder={t('skillPlaceholder')} onChange={(event) => { setSkill(event.target.value) }} />
          <button type="button" className={css.button} disabled={busy} onClick={search}>{t('search')}</button>
        </div>
      </div>
      <div className={css.row}><button type="button" className={css.button} disabled={busy || agentId.length === 0} onClick={discover}>{t('discover')}</button></div>
      {card !== undefined && <div className={css.card}>
        <div className={css.cardTitle}>{card.name} · {card.version}</div>
        <div className={css.meta}>{card.description}</div>
        <div className={css.meta}>{t('skills')}</div>
        {card.skills.length === 0 ? <div className={css.empty}>{t('noSkills')}</div> : card.skills.map(skill => <div className={css.skill} key={skill.id}><div className={css.skillName}>{skill.name} · {skill.id}</div><p className={css.skillDescription}>{skill.description}</p></div>)}
      </div>}
      {error !== undefined && <div className={css.error} role="alert">{t('error')}: {error}</div>}
    </div>
  )
}
