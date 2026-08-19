// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh } from '../src/client/locales.ts'
import { A2ASettingsSection } from '../src/client/A2ASettingsSection.tsx'
import type { A2ARemoteApi } from '../src/client/remote-api.ts'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'

afterEach(cleanup)

const t: Parameters<typeof A2ASettingsSection>[0]['t'] = makeTranslate(zh, {})

describe('A2ASettingsSection', () => {
  it('discovers joined Agents without exposing task execution controls', async () => {
    const api = {
      list: vi.fn(async () => ({ ok: true as const, value: [{ id: 'lab', endpoint: 'https://agent.example', directUpload: true }] })),
      search: vi.fn(async () => ({ ok: true as const, value: [{ id: 'b-vision', endpoint: 'https://b.example/a2a', directUpload: true }] })),
      discover: vi.fn(async () => ({ ok: true as const, value: { agentId: 'lab', name: 'Lab', version: '1', description: 'Vision analysis', protocolVersions: ['1.0'], streaming: false, directUpload: true, inputModes: ['image/png'], outputModes: ['text/plain'], skills: [{ id: 'inspect', name: 'Inspect', description: 'Analyze an image', tags: [], examples: [], inputModes: ['image/png'], outputModes: ['text/plain'] }] } })),
    } as unknown as A2ARemoteApi
    render(<A2ASettingsSection t={t} api={api} close={vi.fn()} useSessions={(() => { throw new Error('unused') })} useWorkspaces={(() => { throw new Error('unused') })} />)
    await waitFor(() => { expect(screen.getByRole('option', { name: /lab/ })).toBeTruthy() })
    expect(screen.getByText('读取 Agent Card')).toBeTruthy()
    expect(screen.getByRole('textbox', { name: '按 Skill 搜索公网 Agent' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '发送 A2A 任务' })).toBeNull()
    expect(document.querySelector('input[type="file"]')).toBeNull()
  })

  it('merges Registry search results into the joined Agent list', async () => {
    const search = vi.fn(async () => ({ ok: true as const, value: [{ id: 'b-vision', endpoint: 'https://b.example/a2a', directUpload: true }] }))
    const api = {
      list: vi.fn(async () => ({ ok: true as const, value: [] })),
      search,
      discover: vi.fn(async () => ({ ok: true as const, value: { agentId: 'b-vision', name: 'Vision', version: '1', description: 'Image analysis', protocolVersions: ['1.0'], streaming: false, directUpload: true, inputModes: ['image/png'], outputModes: ['text/plain'], skills: [] } })),
    } as unknown as A2ARemoteApi
    render(<A2ASettingsSection t={t} api={api} close={vi.fn()} useSessions={(() => { throw new Error('unused') })} useWorkspaces={(() => { throw new Error('unused') })} />)
    await waitFor(() => { expect(screen.getByRole('button', { name: '搜索 Agent' })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: '搜索 Agent' }))
    await waitFor(() => { expect(screen.getByRole('option', { name: /b-vision/ })).toBeTruthy() })
    expect(search).toHaveBeenCalledWith(undefined)
    expect(screen.queryByRole('button', { name: '发送 A2A 任务' })).toBeNull()
  })

  it('stores credentials separately and enables the node after all settings are written', async () => {
    const set = vi.fn(async () => undefined)
    const unset = vi.fn(async () => undefined)
    const nodeSettings = {
      getSnapshot: () => ({
        status: 'ready' as const,
        value: { skills: [] }, base: {}, user: {}, revision: 0, writable: true, mode: 'host' as const,
      }),
      subscribe: () => () => undefined,
      set,
      unset,
    } as SettingsScope<Record<string, unknown>>
    const credentialsSet = vi.fn(async () => ({ result: { ok: true as const, value: {} } }))
    const api = {
      list: vi.fn(async () => ({ ok: true as const, value: [] })),
      search: vi.fn(), discover: vi.fn(),
    } as unknown as A2ARemoteApi
    render(<A2ASettingsSection
      t={t} api={api} nodeSettings={nodeSettings} hostApi={{ credentials: { set: credentialsSet } as never }}
      close={vi.fn()} useSessions={(() => { throw new Error('unused') })} useWorkspaces={(() => { throw new Error('unused') })}
    />)
    fireEvent.change(screen.getByRole('textbox', { name: '节点 ID' }), { target: { value: 'b-vision' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Relay URL' }), { target: { value: 'https://agents.example.com' } })
    fireEvent.change(screen.getByLabelText('Relay Token（留空则保留已有值）'), { target: { value: 'relay-secret' } })
    fireEvent.click(screen.getByRole('button', { name: '保存并加入' }))
    await waitFor(() => { expect(set).toHaveBeenLastCalledWith('enabled', true) })
    expect(credentialsSet).toHaveBeenCalledWith({ ref: 'DSH_A2A_RELAY_TOKEN', value: 'relay-secret' })
    expect(set.mock.calls[0]).toEqual(['enabled', false])
  })
})
