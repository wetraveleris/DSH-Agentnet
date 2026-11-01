import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.env.AVATAR_ROOT ?? process.cwd()
const runsDir = () => join(ROOT, 'outputs', '_runs')

function readState(id) {
  const f = join(runsDir(), id, 'state.json')
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null
}
function writeState(st) {
  const dir = join(runsDir(), st.runId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'state.json'), JSON.stringify(st, null, 2))
}
function listRuns() {
  const dir = runsDir()
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((id) => existsSync(join(dir, id, 'state.json'))).map((id) => {
    try { return readState(id) } catch { return null }
  }).filter(Boolean).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
}

/** Run one prompt on a fresh DSH agent and return its assistant text. */
export async function runAgentOnce(ctx, prompt, opts = {}) {
  const sid = 'run-' + randomUUID()
  const presets = ctx.get('agentPresets')
  let presetId
  let setup
  if (presets) {
    presetId = (await presets.resolve(undefined)).id
    setup = async (agentCtx) => {
      await presets.mount(agentCtx, presetId)
      if (opts.tools === 'none') agentCtx.tools.restrict({ allow: [] })
    }
  }
  let handle
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      handle = await ctx.agents.create({
    sessionId: sid,
    agentOptions: { provider: opts.provider ?? 'deepseek-official', model: opts.model ?? 'deepseek-v4-flash' },
    meta: { cwd: ROOT, ...(presetId ? { agentPreset: presetId } : {}) },
    ...(setup ? { setup } : {}),
      })
      break
    } catch (e) {
      if (!/no agent factory/i.test(String(e?.message ?? e))) throw e
      await new Promise((r) => setTimeout(r, 2000))
    }
  }
  if (!handle) throw new Error('agent 运行时未就绪')
  let text = ''
  const off = ctx.on('session/event', (session, ev) => {
    if (String(session?.id ?? session) !== sid) return
    if (ev.type === 'assistant/message') {
      const parts = ev.data?.message?.content ?? []
      text += parts.filter((p) => p.type === 'text').map((p) => p.text).join('')
    }
  })
  const timeoutMs = Number(opts.timeoutMs ?? 180000)
  let timer
  try {
    handle.agent.followup({ id: randomUUID(), role: 'user', content: [{ type: 'text', text: prompt }], source: { kind: 'user' } })
    await Promise.race([
      handle.agent.whenIdle(),
      new Promise((_, rej) => { timer = setTimeout(() => { try { handle.agent.cancel('timeout') } catch {} ; rej(new Error('任务超时')) }, timeoutMs) }),
    ])
  } finally {
    clearTimeout(timer)
    off?.()
    await handle.dispose().catch(() => {})
  }
  return text
}

function stagePrompt(tpl, stage, variables, task) {
  const vars = Object.entries(variables ?? {}).map(([k, v]) => `- ${k}: ${v}`).join('\n') || '（无）'
  return [
    `你在执行模板「${tpl.meta?.name ?? tpl.id}」的「${stage}」阶段。`,
    tpl.playbook ? `模板手册：\n${tpl.playbook}` : '',
    `任务：${task || '按模板完成本阶段'}`,
    `变量：\n${vars}`,
    '只输出本阶段产物（Markdown），不要解释过程。',
  ].filter(Boolean).join('\n\n')
}

async function runStages(ctx, id) {
  const st = readState(id)
  const tpl = ctx.get('avatarTemplates')?.get?.(st.templateId)
  const start = st.stages.findIndex((s) => s.state !== 'done')
  st.status = 'running'; st.error = null
  writeState(st)
  for (let i = start; i < st.stages.length; i++) {
    const s = st.stages[i]
    s.state = 'running'
    writeState(st)
    try {
      s.output = await runAgentOnce(ctx, stagePrompt(tpl ?? { meta: {}, playbook: '' }, s.id, st.variables, st.message), st.agentOptions)
      s.state = 'done'
    } catch (e) {
      s.state = 'failed'; s.error = String(e?.message ?? e)
      st.status = 'failed'; st.error = s.error; writeState(st); return
    }
    st.percent = Math.round(((i + 1) / st.stages.length) * 100)
    writeState(st)
  }
  st.status = 'done'; st.percent = 100; st.finishedAt = new Date().toISOString(); writeState(st)
}

export function attachRuns(ctx, getTemplate) {
  return {
    list: () => listRuns(),
    get: (id) => readState(id),
    async start(body) {
      const tpl = getTemplate(String(body.templateId ?? ''))
      if (!tpl) throw new Error('模板不存在')
      const pipeline = Array.isArray(body.stages) && body.stages.length ? body.stages : (tpl.meta?.pipeline ?? [])
      const id = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14) + '-' + randomUUID().slice(0, 6)
      const st = {
        runId: id, templateId: tpl.id, templateVersion: tpl.meta?.version, variables: body.variables ?? {},
        message: body.message ?? '', status: 'running', percent: 0,
        stages: pipeline.map((sid) => ({ id: sid, role: tpl.meta?.roles?.[sid] ?? 'maker', state: 'pending', output: null, error: null })),
        createdAt: new Date().toISOString(),
      }
      writeState(st)
      void runStages(ctx, id)
      return st
    },
    async retry(id) {
      const st = readState(id)
      if (!st) throw new Error('运行不存在')
      const idx = st.stages.findIndex((s) => s.state !== 'done')
      if (idx < 0) throw new Error('所有阶段已完成')
      for (let i = idx; i < st.stages.length; i++) { st.stages[i].state = 'pending'; st.stages[i].error = null }
      writeState(st)
      void runStages(ctx, id)
      return st
    },
  }
}
