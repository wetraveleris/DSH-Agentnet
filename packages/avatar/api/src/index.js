import { randomUUID } from 'node:crypto'
import { appendFileSync, readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { attachRuns, runAgentOnce } from './runs.js'
import { attachAgentd } from './agentd.js'
import { dashboardHtml } from './ui.js'
import { join } from 'node:path'

const AGENT_LIB = 'file:///Users/traveler/Desktop/deepseek%20harness独立仓库/packages/core/agent/lib/index.js'
let installModelSelection
await import(AGENT_LIB).then((m) => { installModelSelection = m.installModelSelection }).catch(() => {})

export const name = 'avatar-api'
export const inject = ['webServer', 'tools', 'agents']
const ROOT = process.env.AVATAR_ROOT ?? process.cwd()
const templatesDir = () => join(ROOT, 'templates')

function listTemplates() {
  const dir = templatesDir()
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((n) => !n.startsWith('_') && existsSync(join(dir, n, 'template.json'))).map((id) => {
    try {
      const meta = JSON.parse(readFileSync(join(dir, id, 'template.json'), 'utf8'))
      return { id, name: meta.name ?? id, version: meta.version ?? '1.0.0', description: meta.description ?? '', stages: meta.pipeline ?? [], updated: statSync(join(dir, id, 'template.json')).mtimeMs }
    } catch { return { id, name: id, version: '?', description: '模板解析失败', stages: [] } }
  })
}

function getTemplate(id) {
  const dir = join(templatesDir(), id)
  if (!existsSync(dir)) return null
  const read = (f) => { try { return readFileSync(join(dir, f), 'utf8') } catch { return null } }
  let meta = {}
  try { meta = JSON.parse(read('template.json') ?? '{}') } catch {}
  const versionsDir = join(dir, 'versions')
  const versions = existsSync(versionsDir) ? readdirSync(versionsDir).filter((v) => statSync(join(versionsDir, v)).isDirectory()) : []
  return { id, meta, playbook: read('playbook.md'), checklist: read('checklist.md'), skeleton: read('skeleton.json'), versions }
}

export function apply(ctx) {

  async function ensureAgent(sid) {
    let handle = agents.get(sid)
    if (handle) return handle
    const presets = ctx.get('agentPresets')
    let presetId
    let setup
    if (presets) {
      presetId = (await presets.resolve(undefined)).id
      setup = async (agentCtx) => { await presets.mount(agentCtx, presetId) }
    }
    handle = await ctx.agents.create({
      sessionId: sid,
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      meta: { cwd: process.cwd(), ...(presetId ? { agentPreset: presetId } : {}) },
      ...(setup ? { setup } : {}),
    })
    agents.set(sid, handle)
    return handle
  }

  const runs = attachRuns(ctx, getTemplate)
  const agentd = attachAgentd(ctx, (prompt) => runAgentOnce(ctx, prompt))
  ctx.effect(() => { const t = setInterval(() => { try { agentd.tick() } catch {} }, 15000); return () => clearInterval(t) })
  const subs = new Map()
  let sink = null
  const agents = new Map()
  const history = new Map()
  ctx.on('llm/stream', (options, next) => {
    const inner = next()
    return (async function* () {
      for await (const c of inner) {
        try { sink?.(c) } catch {}
        yield c
      }
    })()
  })
  ctx.on('session/event', (session, event) => {
    if (process.env.AVATAR_DEBUG === '1') try { appendFileSync('/tmp/avatar-events.jsonl', JSON.stringify({ sid: String(session?.id ?? session), type: event?.type, data: JSON.stringify(event?.data ?? null).slice(0, 500) }) + '\n') } catch {}
    const set = subs.get(String(session?.id ?? session))
    if (!set) return
    for (const fn of set) { try { fn(event) } catch {} }
  })
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: '/avatar',
    handler: (_req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(dashboardHtml()) },
  }))
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: '/avatar/',
    handler: (_req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(dashboardHtml()) },
  }))
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix', path: '/api/avatar',
    handler: (req, res) => {
      const u = new URL(req.url ?? '/', 'http://x')
      if (u.pathname === '/api/avatar/ask' && req.method === 'POST') {
        let body = ''
        req.on('data', (c) => { body += c })
        req.on('end', async () => {
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
          let sid = ''
          try {
            const payload = JSON.parse(body || '{}')
            sid = String(payload.sessionId ?? '') || ('avatar-' + randomUUID())
            const presets = ctx.get('agentPresets')
            let setup
            let presetId
            if (presets) {
              presetId = (await presets.resolve(undefined)).id
              setup = async (agentCtx) => {
                if (installModelSelection) installModelSelection(agentCtx, { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' })
                await presets.mount(agentCtx, presetId)
              }
            }
            let handle = agents.get(sid)
            if (!handle) { handle = await ctx.agents.create({
              sessionId: sid,
              agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
              meta: { cwd: process.cwd(), ...(presetId ? { agentPreset: presetId } : {}) },
              ...(setup ? { setup } : {}),
            }); agents.set(sid, handle) }
            const set = new Set()
            subs.set(sid, set)
            const send = (obj) => res.write('data: ' + JSON.stringify(obj) + '\n\n')
            sink = (c) => {
              const t = c?.type ?? c?.kind
              if (t === 'text' && c.text) send({ type: 'token', text: c.text })
              else if (t === 'reasoning' && c.text) send({ type: 'thinking', text: c.text })
            }
            set.add((e) => {
              const t = e?.type ?? e?.data?.type
              if (t === 'assistant/chunk') {
                const c = e?.data?.chunk ?? e?.chunk
                if (c?.type === 'text' && c.text) send({ type: 'token', text: c.text })
                else if (c?.type === 'reasoning') send({ type: 'thinking', text: c.text ?? '' })
              } else if (t === 'assistant/message') {
                const parts = e?.data?.message?.content ?? []
                const text = parts.filter((p) => p?.type === 'text').map((p) => p.text).join('')
                const reasoning = parts.filter((p) => p?.type === 'reasoning').map((p) => p.text).join('')
                if (reasoning) send({ type: 'thinking', text: reasoning })
                if (text) {
                  send({ type: 'message', text })
                  const h2 = history.get(sid) ?? []
                  h2.push({ role: 'assistant', text })
                  history.set(sid, h2)
                }
              } else if (t === 'tool/call') send({ type: 'step', name: e?.data?.name ?? e?.name ?? 'tool' })
              else if (t === 'tool/result') send({ type: 'stepResult' })
            })
            const hist = history.get(sid) ?? []
            hist.push({ role: 'user', text: String(payload.message ?? '') })
            history.set(sid, hist)
            handle.agent.followup({
              id: randomUUID(), role: 'user',
              content: [{ type: 'text', text: String(payload.message ?? '') }],
              source: { kind: 'user' },
            })
            await handle.agent.whenIdle()
            sink = null
            send({ type: 'done', sessionId: sid })
            subs.delete(sid)
            res.end()
          } catch (err) {
            res.write('data: ' + JSON.stringify({ type: 'error', message: String(err?.message ?? err), sessionId: sid }) + '\n\n')
            res.end()
          }
        })
        return
      }
      if (u.pathname === '/api/avatar/send' && req.method === 'POST') {
        let b = ''; req.on('data', (c) => { b += c })
        req.on('end', async () => {
          try {
            const payload = JSON.parse(b || '{}')
            const sid = String(payload.sessionId ?? '') || ('avatar-' + randomUUID())
            const handle = await ensureAgent(sid)
            const hist = history.get(sid) ?? []; hist.push({ role: 'user', text: String(payload.message ?? '') }); history.set(sid, hist)
            handle.agent.followup({ id: randomUUID(), role: 'user', content: [{ type: 'text', text: String(payload.message ?? '') }], source: { kind: 'user' } })
            res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, sessionId: sid }))
          } catch (e) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ detail: String(e?.message ?? e) })) }
        })
        return
      }
      if (u.pathname === '/api/avatar/stream') {
        const sid = u.searchParams.get('sessionId') ?? ''
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
        const send = (obj) => res.write('data: ' + JSON.stringify(obj) + '\n\n')
        const set = subs.get(sid) ?? new Set(); subs.set(sid, set)
        const fn = (e) => {
          const t = e?.type
          if (t === 'assistant/message') {
            const parts = e.data?.message?.content ?? []
            const text = parts.filter((p) => p.type === 'text').map((p) => p.text).join('')
            const reasoning = parts.filter((p) => p.type === 'reasoning').map((p) => p.text).join('')
            if (reasoning) send({ type: 'thinking', text: reasoning })
            if (text) { send({ type: 'message', text }); const h2 = history.get(sid) ?? []; h2.push({ role: 'assistant', text }); history.set(sid, h2) }
          } else if (t === 'turn/start') send({ type: 'turn', phase: 'start' })
          else if (t === 'turn/end') send({ type: 'turn', phase: 'end' })
          else if (t === 'tool/call') send({ type: 'step', name: e.data?.name ?? 'tool' })
        }
        set.add(fn)
        const hb = setInterval(() => { try { res.write(': hb\n\n') } catch {} }, 15000)
        req.on('close', () => { clearInterval(hb); set.delete(fn) })
        return
      }
      if (u.pathname === '/api/avatar/agentd/panel') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(agentd.panel()))
        return
      }
      if (u.pathname === '/api/avatar/agentd/mode' && req.method === 'POST') {
        let b = ''; req.on('data', (c) => { b += c })
        req.on('end', () => { try { const m = JSON.parse(b || '{}').mode; agentd.setMode(m); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ mode: m })) } catch (e) { res.writeHead(400); res.end(JSON.stringify({ detail: String(e) })) } })
        return
      }
      if (u.pathname === '/api/avatar/agentd/plan/generate' && req.method === 'POST') {
        let b = ''; req.on('data', (c) => { b += c })
        req.on('end', async () => { try { const p = await agentd.generatePlan(JSON.parse(b || '{}').instruction ?? ''); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ plan: p })) } catch (e) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ detail: String(e?.message ?? e) })) } })
        return
      }
      if (u.pathname === '/api/avatar/agentd/plan/approve' && req.method === 'POST') {
        try { const p = agentd.approvePlan(); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ plan: p })) } catch (e) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ detail: String(e?.message ?? e) })) }
        return
      }
      const cardResolve = /^\/api\/avatar\/agentd\/cards\/([^/]+)\/resolve$/.exec(u.pathname)
      if (cardResolve && req.method === 'POST') {
        let b = ''; req.on('data', (c) => { b += c })
        req.on('end', () => { try { const card = agentd.resolveCard(decodeURIComponent(cardResolve[1]), JSON.parse(b || '{}').action ?? 'ok'); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, card })) } catch (e) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ detail: String(e?.message ?? e) })) } })
        return
      }
      if (u.pathname === '/api/avatar/agentd/tick' && req.method === 'POST') { agentd.tick(); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true })); return }
      if (u.pathname === '/api/avatar/runs' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ runs: runs.list() }))
        return
      }
      if (u.pathname === '/api/avatar/runs' && req.method === 'POST') {
        let b = ''
        req.on('data', (c) => { b += c })
        req.on('end', async () => {
          try {
            const st = await runs.start(JSON.parse(b || '{}'))
            res.writeHead(200, { 'content-type': 'application/json' })
            res.end(JSON.stringify(st))
          } catch (e) {
            res.writeHead(400, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ detail: String(e?.message ?? e) }))
          }
        })
        return
      }
      const runRetry = /^\/api\/avatar\/runs\/([^/]+)\/retry$/.exec(u.pathname)
      if (runRetry && req.method === 'POST') {
        runs.retry(decodeURIComponent(runRetry[1])).then((st) => {
          res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(st))
        }).catch((e) => {
          res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ detail: String(e?.message ?? e) }))
        })
        return
      }
      const runOne = /^\/api\/avatar\/runs\/([^/]+)$/.exec(u.pathname)
      if (runOne && req.method === 'GET') {
        const st = runs.get(decodeURIComponent(runOne[1]))
        res.writeHead(st ? 200 : 404, { 'content-type': 'application/json' })
        res.end(JSON.stringify(st ?? { detail: '运行不存在' }))
        return
      }
      if (u.pathname === '/api/avatar/templates' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ root: ROOT, templates: listTemplates() }))
        return
      }
      if (u.pathname.startsWith('/api/avatar/templates/') && req.method === 'GET') {
        const id = decodeURIComponent(u.pathname.slice('/api/avatar/templates/'.length))
        const t = getTemplate(id)
        res.writeHead(t ? 200 : 404, { 'content-type': 'application/json' })
        res.end(JSON.stringify(t ?? { detail: '模板不存在' }))
        return
      }
      if (u.pathname === '/api/avatar/history') {
        const sid = u.searchParams.get('sessionId') ?? ''
        const handle = agents.get(sid)
        void handle
        const out = history.get(sid) ?? []
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ sessionId: sid, messages: out }))
        return
      }
      if (u.pathname === '/api/avatar/tools') {
        const t = ctx.tools.get('avatar_ping')
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ registered: Boolean(t), description: t?.description ?? null }))
        return
      }
      if (u.pathname === '/api/avatar/health') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, app: 'avatar', version: '0.0.1', ts: Date.now() }))
        return
      }
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ detail: 'not found' }))
    },
  }))
}
