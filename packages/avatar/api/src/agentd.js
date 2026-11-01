import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runAgentOnce } from './runs.js'

const ROOT = process.env.AVATAR_ROOT ?? process.cwd()
const base = () => join(ROOT, 'outputs', '_agentd')
const day = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` }
const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8').replace(/^\uFEFF/, '')) } catch { return d } }
const writeJson = (f, v) => { mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, JSON.stringify(v, null, 2)) }
const nowHHMM = () => new Date().toTimeString().slice(0, 5)

const TYPE_GATE = { review: 'review', publish: 'approval' }
const TOOL_POLICY = { topic: 'none', script: 'none', improve: 'none', monitor: 'none', assets: 'all', edit: 'all', review: 'all', publish: 'all', report: 'all', sync: 'all' }

export function attachAgentd(ctx, runAgent, publishVideo) {
  try {
    const f = join(base(), 'jobs', `${day()}.json`)
    const data = readJson(f, null)
    if (data) { let changed = false; for (const j of data.jobs) if (j.state === 'running') { j.state = 'pending'; changed = true }; if (changed) writeJson(f, data) }
  } catch {}
  const modeFile = () => join(base(), 'mode.json')
  const planFile = () => join(base(), 'plans', `${day()}.json`)
  const jobsFile = () => join(base(), 'jobs', `${day()}.json`)
  const cardsFile = () => join(base(), 'cards', `${day()}.json`)
  const sessionFile = () => join(base(), 'days', day(), 'session.jsonl')

  const mode = () => readJson(modeFile(), { mode: 'auto' }).mode
  const setMode = (m) => { writeJson(modeFile(), { mode: m, updatedAt: Date.now() }); return m }
  const plan = () => readJson(planFile(), null)
  const jobs = () => readJson(jobsFile(), { jobs: [] }).jobs
  const cards = () => readJson(cardsFile(), []).filter((c) => c.status === 'pending')

  function emitEvent(type, data = {}) {
    try {
      const f = join(base(), 'events.jsonl')
      mkdirSync(join(base()), { recursive: true })
      writeFileSync(f, JSON.stringify({ ts: Date.now(), event: type, ...data }) + '\n', { flag: 'a' })
    } catch {}
  }

  function record(actor, content, extra = {}) {
    mkdirSync(join(base(), 'days', day()), { recursive: true })
    writeFileSync(sessionFile(), JSON.stringify({ ts: Date.now(), actor, content, ...extra }) + '\n', { flag: 'a' })
  }

  function addCard(card) {
    const all = readJson(cardsFile(), [])
    const full = { ...card, id: card.id ?? `card_${Date.now()}`, status: 'pending', createdAt: Date.now() }
    all.push(full); writeJson(cardsFile(), all); emitEvent('card.created', { id: full.id, cardType: full.type, title: full.title }); return full
  }

  function normalize(items) {
    const anchor = new Date(); const start = anchor.getHours() * 60 + anchor.getMinutes() + 10
    return (items ?? []).slice(0, 10).map((it, i) => {
      const t = (start + i * 30) % 1440
      return { time: `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`, type: it.type ?? 'topic', title: it.title ?? '任务', why: it.why ?? '', gate: it.gate ?? 'none' }
    })
  }

  async function generatePlan(instruction = '') {
    let recent = ''
    try {
      const f = sessionFile()
      if (existsSync(f)) {
        recent = readFileSync(f, 'utf8').split('\n').filter(Boolean).slice(-10).map((l) => { try { const m = JSON.parse(l); return `${m.actor}: ${String(m.content).slice(0, 80)}` } catch { return '' } }).filter(Boolean).join('\n')
      }
    } catch {}
    const prompt = [
      '你是用户的常驻主编（24 小时在岗的数字员工）。请给出今天的计划。',
      `现在时间：${new Date().toLocaleString('zh-CN')}。所有时间必须从当前时间往后排，不要排已经过去的时间。`,
      '要求：恰好 6–8 项；必须覆盖 topic/script/assets/edit/review/publish/sync/report 八类（可合并但至少 6 类）；每项写 why；review/publish 标 gate（review/approval）。',
      instruction ? `用户要求：${instruction}` : '',
      recent.length ? `最近执行记录：\n${recent}` : '',
      '只输出 JSON：{"summary":"一句话","rhythm":["节奏1"],"items":[{"time":"HH:MM","type":"topic","title":"...","why":"...","gate":"none"}]}',
    ].filter(Boolean).join('\n')
    let text = ''
    const builtin = ctx.get('avatarPlanner')
    text = builtin ? await builtin(prompt) : await runAgent(prompt)
    let parsed = null
    try { parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) } catch {}
    if (!parsed || !Array.isArray(parsed.items)) parsed = { summary: '今日计划', rhythm: [], items: [] }
    const items = normalize(parsed.items)
    const p = { date: day(), version: (plan()?.version ?? 0) + 1, status: 'draft', summary: parsed.summary ?? '', rhythm: parsed.rhythm ?? [], items, generatedAt: Date.now() }
    writeJson(planFile(), p)
    addCard({ id: `card_plan_${p.version}`, type: 'plan', title: `今日计划 v${p.version}（待批准）`, body: p.summary, rhythm: p.rhythm, items })
    record('agent', `今日计划 v${p.version}：${p.summary}`)
    return p
  }

  function approvePlan() {
    const p = plan(); if (!p) throw new Error('没有计划')
    p.status = 'approved'; p.approvedAt = Date.now(); writeJson(planFile(), p)
    const all = readJson(cardsFile(), [])
    for (const c of all) if (c.status === 'pending' && c.type !== 'notice') { c.status = 'resolved'; c.resolution = { action: 'superseded' } }
    writeJson(cardsFile(), all)
    writeJson(jobsFile(), { jobs: p.items.map((it, i) => ({ id: `p${String(i + 1).padStart(2, '0')}`, type: it.type, title: it.title, at: it.time, state: 'pending' })) })
    record('system', `计划 v${p.version} 已批准`)
    dispatch()
    return p
  }

  let busy = false
  function repairWaitingCards() {
    const list = readJson(jobsFile(), { jobs: [] })
    const pending = readJson(cardsFile(), []).filter((c) => c.status === 'pending')
    let changed = false
    for (const j of list.jobs) {
      if (j.state !== 'waiting') continue
      if (pending.some((c) => c.jobId === j.id)) continue
      const lv = latestVideo()
      addCard({ type: j.type === 'publish' ? 'approval' : 'review', jobId: j.id, title: j.title, body: '确认后继续', artifacts: lv ? [lv] : [] })
      changed = true
    }
    void changed
  }

  async function dispatch() {
    if (busy || mode() !== 'auto') return
    repairWaitingCards()
    const p = plan(); if (!p || p.status !== 'approved') return
    const list = readJson(jobsFile(), { jobs: [] })
    const job = list.jobs.find((j) => j.state === 'pending')
    if (!job) return
    busy = true
    job.state = 'running'; job.startedAt = Date.now(); writeJson(jobsFile(), list)
    try {
      if (job.type === 'review' || job.type === 'publish') {
        const latest = latestVideo()
        job.state = 'waiting'; writeJson(jobsFile(), list)
        addCard({ type: job.type === 'publish' ? 'approval' : 'review', jobId: job.id, title: job.title, body: '确认后继续', artifacts: latest ? [latest] : [] })
        record('agent', `等你确认：${job.title}`)
        busy = false
        return
      }
      const policy = TOOL_POLICY[job.type] ?? 'none'
      const hint = policy === 'none' ? '不要调用工具。' : (job.type === 'edit' ? '优先直接用 skills/shared/scripts 里的现成脚本（如 slideshow.py）和 ffmpeg 产出，不要长时间探索目录。' : '可以调用需要的工具。')
      const text = await runAgent(`你是执行者。完成任务并输出结论，用中文，不超过 300 字。${hint}任务：${job.title}`, { timeoutMs: policy === 'none' ? 90000 : (job.type === 'edit' ? 600000 : 240000), tools: policy })
      job.state = 'done'; job.finishedAt = Date.now(); job.note = String(text).slice(0, 120); writeJson(jobsFile(), list)
      emitEvent('job.done', { id: job.id, title: job.title, jobType: job.type })
      record('agent', `完成：${job.title}`)
    } catch (e) {
      job.state = 'failed'; job.note = String(e?.message ?? e).slice(0, 400); writeJson(jobsFile(), list)
      emitEvent('job.failed', { id: job.id, title: job.title, error: job.note })
      record('system', `失败：${job.title} — ${job.note}`)
    } finally { busy = false; void dispatch() }
  }

  function latestVideo() {
    const dir = join(ROOT, 'outputs')
    let best = null
    const walk = (d, depth) => {
      if (depth > 4 || !existsSync(d)) return
      for (const n of readdirSync(d)) {
        if (n.startsWith('_') || n === 'node_modules') continue
        const f = join(d, n); let st
        try { st = statSync(f) } catch { continue }
        if (st.isDirectory()) walk(f, depth + 1)
        else if (/\.mp4$/i.test(n) && st.size > 100 * 1024) { if (!best || st.mtimeMs > best.mtime) best = { path: f.slice(ROOT.length + 1), mtime: st.mtimeMs } }
      }
    }
    walk(dir, 0)
    return best ? best.path : null
  }

  function resolveCard(cardId, action) {
    const all = readJson(cardsFile(), [])
    const card = all.find((c) => c.id === cardId)
    if (!card) throw new Error('卡片不存在')
    card.status = 'resolved'; card.resolution = { action, at: Date.now() }
    writeJson(cardsFile(), all)
    if (card.type === 'plan' && action === 'approve') approvePlan()
    if (card.type === 'plan' && action === 'reject') void generatePlan('用户打回了上一版计划，请换一种安排')
    if (card.type === 'approval' && action === 'approve') {
      const video = (card.artifacts ?? []).find((a) => String(a).endsWith('.mp4')) ?? latestVideo()
      record('system', '发布已批准，开始提交抖音…')
      emitEvent('publish.start', { video })
      if (publishVideo) {
        void publishVideo({ video, title: card.title, content: card.body ?? '', tags: '', exec: true }).then((r) => {
          record('agent', r.ok ? `发布${r.dryRun ? '（dry-run）' : '成功'}：${r.message || r.state}` : `发布失败：${r.message || r.output}`)
          emitEvent(r.ok ? 'publish.done' : 'publish.failed', { dryRun: r.dryRun, message: r.message })
        })
      }
    }
    if (card.jobId) {
      const list = readJson(jobsFile(), { jobs: [] })
      const j = list.jobs.find((x) => x.id === card.jobId)
      if (j) { j.state = 'done'; j.finishedAt = Date.now(); writeJson(jobsFile(), list) }
    }
    void dispatch()
    return card
  }


  function watchdog() {
    const list = readJson(jobsFile(), { jobs: [] })
    let changed = false
    for (const j of list.jobs) {
      if (j.state === 'running' && j.startedAt && Date.now() - j.startedAt > 6 * 60000) {
        j.state = 'failed'; j.note = '看门狗：任务长时间无进展，已终止'; j.finishedAt = Date.now(); changed = true
        record('system', `看门狗：${j.title} 超时，已终止并转下一项`); emitEvent('watchdog.timeout', { id: j.id, title: j.title })
      }
    }
    if (changed) { writeJson(jobsFile(), list); void dispatch() }
  }

  ctx.effect(() => { const t = setInterval(() => { try { watchdog() } catch {} }, 60000); return () => clearInterval(t) })

  return {
    panel: () => ({ date: day(), mode: mode(), plan: plan(), jobs: jobs(), cards: cards(), sessionFile: sessionFile(), workStart: 0, workEnd: 24, isToday: true, lanes: { content: { busy: false, pending: jobs().filter((j) => j.state === 'pending').length }, ops: { busy: false, pending: 0 }, improve: { busy: false, pending: 0 } } }),
    setMode, generatePlan, approvePlan, resolveCard,
    tick: () => void dispatch(),
    async ask(text) { return runAgent(text) },
  }
}
