import { randomUUID } from 'node:crypto'
import { appendFileSync, readdirSync, readFileSync, existsSync, statSync, createReadStream, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { spawn } from 'node:child_process'
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



const profilesDir = () => join(ROOT, 'profiles')
function listPersonas() {
  const dir = profilesDir()
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((n) => !n.startsWith('.') && statSync(join(dir, n)).isDirectory()).map((n) => {
    let desc = ''
    for (const f of ['identity.md', 'README.md']) {
      const p = join(dir, n, f)
      if (existsSync(p)) { desc = readFileSync(p, 'utf8').split('\n').find((l) => l.trim() && !l.startsWith('#') && !l.startsWith('<!--'))?.trim() ?? ''; break }
    }
    return { name: n, description: desc.slice(0, 100) }
  })
}
function personaFiles(name) {
  const dir = join(profilesDir(), name)
  if (!existsSync(dir)) return null
  return readdirSync(dir).filter((f) => !f.startsWith('.') && statSync(join(dir, f)).isFile()).map((f) => ({ filename: f, content: readFileSync(join(dir, f), 'utf8') }))
}

function listSkills() {
  const dir = join(ROOT, 'skills', 'builtin')
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((n) => existsSync(join(dir, n, 'SKILL.md'))).map((id) => {
    const raw = readFileSync(join(dir, id, 'SKILL.md'), 'utf8').slice(0, 800)
    const m = /^---[\s\S]*?description:\s*([\s\S]*?)\n[a-z-]+:/m.exec(raw) || /^---[\s\S]*?description:\s*(.*)/m.exec(raw)
    return { id, description: (m?.[1] ?? '').replace(/^[>|]-?\s*/m, '').replace(/\n\s+/g, ' ').trim().slice(0, 120) }
  }).sort((a, b) => a.id.localeCompare(b.id))
}


function listOutputTree() {
  const rootDir = join(ROOT, 'outputs')
  if (!existsSync(rootDir)) return []
  const kindOf = (n) => { const e = n.slice(n.lastIndexOf('.') + 1).toLowerCase(); return ['mp4','mov','webm'].includes(e) ? 'video' : ['mp3','wav','m4a'].includes(e) ? 'audio' : ['jpg','jpeg','png','webp','gif'].includes(e) ? 'image' : ['srt','txt','md','json'].includes(e) ? 'text' : 'other' }
  const nodes = []
  for (const top of readdirSync(rootDir)) {
    if (top.startsWith('_') || top === 'node_modules') continue
    const f = join(rootDir, top); let st
    try { st = statSync(f) } catch { continue }
    if (st.isFile()) { nodes.push({ name: top, type: 'file', path: top, kind: kindOf(top), size: st.size, mtime: st.mtimeMs }); continue }
    const children = []
    const walk = (d, rel, depth2) => {
      if (depth2 > 3) return
      for (const n of readdirSync(d)) {
        if (n.startsWith('.')) continue
        const p2 = join(d, n), r2 = rel + '/' + n
        let s2; try { s2 = statSync(p2) } catch { continue }
        if (s2.isDirectory()) walk(p2, r2, depth2 + 1)
        else children.push({ name: n, type: 'file', path: r2, kind: kindOf(n), size: s2.size, mtime: s2.mtimeMs })
      }
    }
    walk(f, top, 0)
    if (!children.length) continue
    nodes.push({ name: top, type: 'dir', path: top, fileCount: children.length, children: children.sort((a, b) => b.mtime - a.mtime).slice(0, 40), mtime: st.mtimeMs })
  }
  return nodes.sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0))
}

function listOutputs() {
  const dir = join(ROOT, 'outputs')
  const out = []
  const walk = (d, depth) => {
    if (depth > 4 || !existsSync(d)) return
    for (const n of readdirSync(d)) {
      if (n.startsWith('_') || n === 'node_modules') continue
      const f = join(d, n)
      let st
      try { st = statSync(f) } catch { continue }
      if (st.isDirectory()) walk(f, depth + 1)
      else if (/\.(mp4|jpg|jpeg|png|webp|mp3|srt)$/i.test(n) && st.size > 10240) {
        out.push({ path: f.slice(ROOT.length + 1), name: n, size: st.size, mtime: st.mtimeMs })
      }
    }
  }
  walk(dir, 0)
  return out.sort((a, b) => b.mtime - a.mtime).slice(0, 60)
}

function listProfiles() {
  const dir = join(ROOT, 'profiles')
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((n) => !n.startsWith('.')).map((n) => {
    const f = join(dir, n); const st = statSync(f)
    return { name: n, size: st.size, mtime: st.mtimeMs, dir: st.isDirectory() }
  })
}

function listAccounts() {
  const dir = join(ROOT, 'outputs', '_login')
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => {
    try { const d = JSON.parse(readFileSync(join(dir, n), 'utf8')); return { file: n, state: d.state ?? '?', message: String(d.message ?? '').slice(0, 80), ts: d.ts ?? 0 } } catch { return null }
  }).filter(Boolean)
}

import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

  function compatApi(pathname, req, res, deps) {
    const agentd = deps.agentd
    const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
    if (pathname === '/api/chat/stream' && req.method === 'POST') { deps.chatStream(req, res); return }
    if (pathname === '/api/chat/stop' && req.method === 'POST') { deps.chatStop(req, res); return }
    if (pathname.startsWith('/api/chat/last/')) { json(200, { status: 'done', text: '' }); return }
    if (pathname.startsWith('/api/chat/jobs/')) { json(404, { detail: '任务记录已失效，请重新发送' }); return }
    if (pathname === '/api/personas' && req.method === 'GET') return json(200, listPersonas())
    if (pathname === '/api/personas' && req.method === 'POST') {
      let b = ''; req.on('data', (c) => { b += c }); req.on('end', () => {
        try { const name = String(JSON.parse(b || '{}').name ?? '').trim(); if (!name) throw new Error('缺少 name'); const dir = join(profilesDir(), name); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'identity.md'), '# ' + name + '\n'); json(200, { ok: true, name }) } catch (e) { json(400, { detail: String(e?.message ?? e) }) }
      }); return
    }
    const pm = /^\/api\/persona\/([^/]+)(\/files|\/file)?$/.exec(pathname)
    if (pm) {
      const name = decodeURIComponent(pm[1]); const sub = pm[2] ?? ''
      if (sub === '' && req.method === 'GET') { const files = personaFiles(name); if (!files) return json(404, { detail: '画像不存在' }); return json(200, { name, content: files.map((f) => f.content).join('\n\n') }) }
      if (sub === '' && req.method === 'DELETE') { const dir = join(profilesDir(), name); if (existsSync(dir)) rmSync(dir, { recursive: true, force: true }); return json(200, { ok: true, deleted: name }) }
      if (sub === '/files') { const files = personaFiles(name); return files ? json(200, { name, files }) : json(404, { detail: '画像不存在' }) }
      if (sub === '/file' && req.method === 'PUT') {
        let b = ''; req.on('data', (c) => { b += c }); req.on('end', () => {
          try { const { filename, content } = JSON.parse(b || '{}'); if (!filename) throw new Error('缺少 filename'); const dir = join(profilesDir(), name); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, String(filename)), String(content ?? '')); json(200, { ok: true }) } catch (e) { json(400, { detail: String(e?.message ?? e) }) }
        }); return
      }
    }
    if (pathname === '/api/status') {
      return json(200, { gateway: true, transport: 'dsh', runtime: 'dsh', skills: listSkills().map((x) => ({ name: x.id, description: x.description, layer: 'builtin', needsApi: false })), personas: [] })
    }
    if (pathname === '/api/skills') return json(200, listSkills().map((x) => ({ name: x.id, description: x.description, layer: 'builtin', needsApi: false })))
    if (pathname === '/api/outputs') return json(200, listOutputTree())
    if (pathname === '/api/output/content') {
      const q = new URL(String(req.url ?? '/'), 'http://x').searchParams.get('path') ?? ''
      const f = join(ROOT, 'outputs', q)
      if (!existsSync(f) || !statSync(f).isFile()) return json(404, { detail: 'not found' })
      const ext = f.slice(f.lastIndexOf('.')).toLowerCase()
      const isBinary = ['.mp4','.mov','.webm','.mp3','.wav','.png','.jpg','.jpeg','.webp','.gif'].includes(ext)
      return json(200, { path: q, content: isBinary ? '' : readFileSync(f, 'utf8').slice(0, 200000), kind: ext.replace('.', ''), isBinary })
    }
    if (pathname === '/api/templates') return json(200, { templates: listTemplates() })
    if (pathname.startsWith('/api/templates/')) {
      const id = decodeURIComponent(pathname.slice('/api/templates/'.length))
      const t = getTemplate(id)
      return json(t ? 200 : 404, t ?? { detail: '模板不存在' })
    }
    if (pathname.startsWith('/api/agentd/')) {
      const sub = pathname.slice('/api/agentd/'.length)
      if (sub === 'panel') return json(200, agentd.panel())
      if (sub === 'mode') { let b = ''; req.on('data', (c) => { b += c }); req.on('end', () => { try { agentd.setMode(JSON.parse(b || '{}').mode); json(200, { mode: agentd.panel().mode }) } catch (e) { json(400, { detail: String(e) }) } }); return }
      if (sub === 'away') { void agentd.generatePlan('老板离开，给接下来 6–8 小时的自主安排，从当前时间起'); return json(200, { ok: true }) }
      if (sub === 'plan/approve') { try { return json(200, { plan: agentd.approvePlan() }) } catch (e) { return json(400, { detail: String(e?.message ?? e) }) } }
      if (sub === 'plan/generate') { void agentd.generatePlan(''); return json(200, { ok: true }) }
      if (sub === 'plan/revise') { let b = ''; req.on('data', (c) => { b += c }); req.on('end', () => { const ins = JSON.parse(b || '{}').instruction ?? ''; void agentd.generatePlan(String(ins)); json(200, { ok: true }) }); return }
      const m = /^cards\/([^/]+)\/resolve$/.exec(sub)
      if (m) { let b = ''; req.on('data', (c) => { b += c }); req.on('end', () => { try { agentd.resolveCard(decodeURIComponent(m[1]), JSON.parse(b || '{}').action ?? 'ok'); json(200, { ok: true }) } catch (e) { json(400, { detail: String(e?.message ?? e) }) } }); return }
    }
    if (pathname.startsWith('/api/media/')) { serveOutputsMedia(pathname.slice('/api/media/'.length), req, res); return }
    if (pathname.startsWith('/api/output/')) { serveOutputsMedia(pathname.slice('/api/output/'.length), req, res); return }
    if (pathname === '/api/artifacts/archive') {
      const q = new URL(String(req.url ?? '/'), 'http://x').searchParams.get('path') ?? ''
      const dir = join(ROOT, 'outputs', q)
      const paths = existsSync(dir) && statSync(dir).isDirectory() ? readdirSync(dir).slice(0, 200).map((n) => q.replace(/\/$/, '') + '/' + n) : []
      return json(200, { paths })
    }
    const stubs = {
      '/api/trends': { trends: [], updated: 0 },
      '/api/schedule': [],
      '/api/schedule/context': {},
      '/api/sessions': { sessions: [] },
      '/api/settings/bootstrap': {},
      '/api/settings/harness': { runtime: 'dsh', models: {}, sandbox: 'workspace-write', codex_auto_approve: false, locked: false, agents: [] },
      '/api/ideas': [],
      '/api/analytics/platforms': [],
      '/api/personas': [],
      '/api/profile': {},
      '/api/publishing-policy': {},
      '/api/upload/limits': { maxBytes: 104857600 },
    }
    if (pathname in stubs) return json(200, stubs[pathname])
    if (pathname === '/api/accounts') {
      const names = ['douyin', 'xiaohongshu', 'bilibili', 'kuaishou', 'shipinhao']
      return json(200, names.map((p) => {
        const hit = listAccounts().find((a) => a.file.startsWith(p))
        return { platform: p, name: p, loggedIn: Boolean(hit && /success|ok|logged/i.test(String(hit.state))), status: hit?.state ?? 'unknown', message: hit?.message ?? '' }
      }))
    }
    if (pathname.startsWith('/api/accounts/')) return json(200, { ok: true })
    return json(404, { detail: 'not found' })
  }


  function serveOutputsMedia(relRaw, req, res) {
    const base = join(ROOT, 'outputs')
    const rel = decodeURIComponent(String(relRaw)).replace(/^outputs\//, '').replace(/^\.\//, '')
    const file = join(base, rel)
    if (!file.startsWith(base) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end('not found'); return }
    const st = statSync(file)
    const ext = file.slice(file.lastIndexOf('.')).toLowerCase()
    const mime = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.srt': 'text/plain; charset=utf-8', '.json': 'application/json', '.html': 'text/html; charset=utf-8' }[ext] ?? 'application/octet-stream'
    res.setHeader('content-type', mime); res.setHeader('accept-ranges', 'bytes')
    const range = req.headers.range
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range)
      const start = m?.[1] ? parseInt(m[1], 10) : 0
      const end = m?.[2] ? parseInt(m[2], 10) : st.size - 1
      res.writeHead(206, { 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': end - start + 1 })
      createReadStream(file, { start, end }).pipe(res); return
    }
    res.writeHead(200, { 'content-length': st.size })
    createReadStream(file).pipe(res)
  }

  function serveApp(pathname, req, res) {
    const distDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist-app')
    const assets = join(distDir, 'assets')
    if (pathname.startsWith('/avatar/app/assets/')) {
      const f = join(assets, pathname.slice('/avatar/app/assets/'.length))
      if (existsSync(f)) {
        const mime = f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : f.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream'
        res.writeHead(200, { 'content-type': mime }); res.end(readFileSync(f)); return
      }
    }
    const idx = join(distDir, 'index.html')
    if (existsSync(idx)) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(readFileSync(idx)) }
    else { res.writeHead(404); res.end('ui not built') }
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


  function publishVideo(p) {
    return new Promise((resolve) => {
      try {
        const script = join(ROOT, 'skills', 'shared', 'scripts', 'douyin_publish.py')
        if (!existsSync(script)) throw new Error('找不到 douyin_publish.py（AVATAR_ROOT=' + ROOT + '）')
        const video = String(p.video ?? '')
        if (!video) throw new Error('缺少 video')
        const statusFile = join(ROOT, 'outputs', '_agentd', `publish-${Date.now()}.json`)
        const py = process.env.PYTHON ?? 'python3'
        const real = process.env.AVATAR_PUBLISH === '1'
        const exec = Boolean(p.exec) && real
        const args = [script, 'publish-video', '--video', video, '--title', String(p.title ?? '今日更新').slice(0, 30), '--content', String(p.content ?? ''), '--tags', String(p.tags ?? ''), '--status-file', statusFile]
        if (exec) args.push('--exec')
        const child = spawn(py, args, { cwd: ROOT, env: process.env })
        let out = ''
        child.stdout.on('data', (d) => { out += d }); child.stderr.on('data', (d) => { out += d })
        child.on('close', (code) => {
          let st = {}
          try { st = JSON.parse(readFileSync(statusFile, 'utf8')) } catch {}
          resolve({ ok: code === 0, dryRun: !exec, state: st.state ?? (code === 0 ? 'done' : 'failed'), message: st.message ?? '', output: out.slice(-600) })
        })
      } catch (e) { resolve({ ok: false, state: 'failed', message: String(e?.message ?? e) }) }
    })
  }


  for (const p of ['/api/status', '/api/skills', '/api/outputs', '/api/templates', '/api/templates/', '/api/agentd', '/api/sessions', '/api/artifacts', '/api/media', '/api/output', '/api/accounts', '/api/chat', '/api/personas', '/api/persona']) {
    ctx.effect(() => ctx.webServer.register({
      kind: ['/api/media', '/api/output', '/api/templates', '/api/agentd', '/api/sessions', '/api/artifacts', '/api/accounts', '/api/chat', '/api/personas', '/api/persona'].includes(p) ? 'prefix' : 'exact',
      path: p,
      handler: (req, res) => { try { compatApi(String(req.url ?? '/').split('?')[0], req, res, deps) } catch (e) { res.writeHead(500); res.end(String(e)) } },
    }))
  }
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix', path: '/avatar/app',
    handler: (req, res) => {
      const pathname = String(req.url ?? '/').split('?')[0]
      if (pathname === '/avatar/app') { res.writeHead(301, { location: '/avatar/app/' }); res.end(); return }
      const rest = pathname.slice('/avatar/app'.length)
      if (rest.startsWith('/api/')) { compatApi(rest, req, res, deps); return }
      serveApp(pathname, req, res)
    },
  }))


  async function chatStream(req, res) {
    let b = ''; req.on('data', (c) => { b += c })
    req.on('end', async () => {
      const write = (id, event, payload) => { try { res.write(`id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(payload)}\n\n`) } catch {} }
      try {
        const payload = JSON.parse(b || '{}')
        const message = String(payload.message ?? '')
        const sid = String(payload.sessionId ?? '') || ('avatar-' + randomUUID())
        const handle = await ensureAgent(sid)
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
        const set = subs.get(sid) ?? new Set(); subs.set(sid, set)
        let closed = false
        const finish = () => { if (!closed) { closed = true; write(0, 'done', { sessionKey: sid }); res.end() } }
        const fn = (e) => {
          const t = e?.type
          if (t === 'assistant/message') {
            const parts = e.data?.message?.content ?? []
            const text = parts.filter((p) => p.type === 'text').map((p) => p.text).join('')
            const reasoning = parts.filter((p) => p.type === 'reasoning').map((p) => p.text).join('')
            if (reasoning) write(1, 'thinking', reasoning)
            if (text) write(2, 'token', text)
          } else if (t === 'tool/call') write(3, 'step', { id: e.data?.name ?? 'tool', label: e.data?.name ?? '工具', state: 'running' })
          else if (t === 'tool/result') write(4, 'step', { id: 'tool', label: '工具', state: 'done' })
          else if (t === 'turn/end') {
            const r = e.data?.reason
            if (r?.kind === 'error') { write(5, 'error', String(r.error?.message ?? '执行失败')); closed = true; res.end() }
            else finish()
          }
        }
        set.add(fn)
        req.on('close', () => { set.delete(fn) })
        const hist = history.get(sid) ?? []; hist.push({ role: 'user', text: message }); history.set(sid, hist)
        handle.agent.followup({ id: randomUUID(), role: 'user', content: [{ type: 'text', text: message }], source: { kind: 'user' } })
      } catch (e) {
        try { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ detail: String(e?.message ?? e) })) } catch {}
      }
    })
  }

  function chatStop(req, res) {
    let b = ''; req.on('data', (c) => { b += c })
    req.on('end', () => {
      try { const sid = JSON.parse(b || '{}').sessionId; const h = agents.get(String(sid)); h?.agent?.cancel?.('user-stop') } catch {}
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ stopped: true }))
    })
  }

  const deps = { get agentd() { return agentd }, chatStream, chatStop }

  const runs = attachRuns(ctx, getTemplate)
  const agentd = attachAgentd(ctx, (prompt) => runAgentOnce(ctx, prompt), publishVideo)
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
      if (u.pathname === '/api/avatar/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
        const f = join(ROOT, 'outputs', '_agentd', 'events.jsonl')
        let pos = 0
        try { if (existsSync(f)) pos = statSync(f).size } catch {}
        const timer = setInterval(() => {
          try {
            if (!existsSync(f)) return
            const size = statSync(f).size
            if (size <= pos) return
            const buf = readFileSync(f)
            const chunk = buf.subarray(pos).toString('utf8')
            pos = buf.length
            for (const line of chunk.split('\n').filter(Boolean)) res.write('data: ' + line + '\n\n')
          } catch {}
        }, 2000)
        req.on('close', () => clearInterval(timer))
        return
      }
      if (u.pathname === '/api/avatar/publish' && req.method === 'POST') {
        let b = ''; req.on('data', (c) => { b += c })
        req.on('end', async () => {
          try { const p = JSON.parse(b || '{}'); const r = await publishVideo(p); res.writeHead(r.ok ? 200 : 400, { 'content-type': 'application/json' }); res.end(JSON.stringify(r)) }
          catch (e) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ detail: String(e?.message ?? e) })) }
        })
        return
      }
      if (u.pathname === '/api/avatar/skills') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ skills: listSkills() })); return }
      if (u.pathname === '/api/avatar/outputs') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ outputs: listOutputs() })); return }
      if (u.pathname === '/api/avatar/profiles') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ profiles: listProfiles() })); return }
      if (u.pathname === '/api/avatar/accounts') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ accounts: listAccounts() })); return }
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
