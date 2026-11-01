import { randomUUID } from 'node:crypto'
import { appendFileSync, readdirSync, readFileSync, existsSync, statSync, createReadStream, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { attachRuns, runAgentOnce } from './runs.js'
import { attachAgentd } from './agentd.js'
import { sendText, parseText, tenantToken, uploadImage, uploadFile, sendPayload, sendCard, approvalCard } from './feishu.js'
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
    if (pathname.startsWith('/api/chat/jobs/')) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
      res.write('id: 0\nevent: done\ndata: {}\n\n'); res.end(); return
    }
    const tm = /^\/api\/templates\/([^/]+)\/(save|versions|rollback|run)$/.exec(pathname)
    if (tm) {
      const id = decodeURIComponent(tm[1]); const action = tm[2]
      if (action === 'versions') return json(200, { versions: deps.listTemplateVersions(id) })
      if (action === 'save' && req.method === 'POST') {
        let b = ''; req.on('data', (c) => { b += c }); req.on('end', () => {
          try {
            const body = JSON.parse(b || '{}')
            const files = body.files ?? {}
            const tdir = join(ROOT, 'templates', id)
            if (!existsSync(tdir)) throw new Error('模板不存在')
            deps.snapshotTemplate(id)
            for (const [f, content] of Object.entries(files)) writeFileSync(join(tdir, f), String(content))
            json(200, { ok: true, versions: deps.listTemplateVersions(id).length })
          } catch (e) { json(400, { detail: String(e?.message ?? e) }) }
        }); return
      }
      if (action === 'rollback' && req.method === 'POST') {
        let b = ''; req.on('data', (c) => { b += c }); req.on('end', () => {
          try {
            const v = String(JSON.parse(b || '{}').version ?? '')
            const vdir = join(ROOT, 'templates', id, 'versions', v)
            if (!existsSync(vdir)) throw new Error('版本不存在')
            const tdir = join(ROOT, 'templates', id)
            for (const f of readdirSync(vdir)) writeFileSync(join(tdir, f), readFileSync(join(vdir, f)))
            json(200, { ok: true, restored: v })
          } catch (e) { json(400, { detail: String(e?.message ?? e) }) }
        }); return
      }
      if (action === 'run' && req.method === 'POST') {
        let b = ''; req.on('data', (c) => { b += c }); req.on('end', async () => {
          try { const body = JSON.parse(b || '{}'); const st = await deps.runs.start({ templateId: id, variables: body.variables ?? {}, message: body.message ?? '' }); json(200, st) } catch (e) { json(400, { detail: String(e?.message ?? e) }) }
        }); return
      }
    }
    if (pathname === '/api/rsi/diagnose') { return json(200, deps.diagnose(new URL(String(req.url ?? '/'), 'http://x').searchParams.get('templateId') ?? undefined)) }
    if (pathname === '/api/rsi/proposals') { return json(200, { proposals: deps.listProposals() }) }
    if (pathname === '/api/rsi/propose' && req.method === 'POST') {
      let b = ''; req.on('data', (c) => { b += c }); req.on('end', async () => {
        try { const p = await deps.propose(String(JSON.parse(b || '{}').templateId ?? '')); json(200, p) } catch (e) { json(400, { detail: String(e?.message ?? e) }) }
      }); return
    }
    if (pathname === '/api/rsi/apply' && req.method === 'POST') {
      let b = ''; req.on('data', (c) => { b += c }); req.on('end', () => {
        try { const p = deps.applyProposal(String(JSON.parse(b || '{}').proposalId ?? '')); json(200, p) } catch (e) { json(400, { detail: String(e?.message ?? e) }) }
      }); return
    }
    if (pathname === '/api/meter/usage') return json(200, deps.usageSummary())
    if (pathname === '/api/steps') return json(200, { steps: deps.stepsSummary(Number(new URL(String(req.url ?? '/'), 'http://x').searchParams.get('limit') ?? 50)) })
    if (pathname === '/api/feishu/event' && req.method === 'POST') { deps.feishuEvent(req, res); return }
    if (pathname === '/api/feishu/health') return json(200, { ok: true, appId: Boolean(deps.feishuAppId()) })
    if (pathname === '/api/feishu/test-media' && process.env.AVATAR_DEBUG === '1') {
      const q = new URL(String(req.url ?? '/'), 'http://x')
      const kind = q.searchParams.get('kind') ?? 'video'
      const chat = q.searchParams.get('chat') ?? ''
      deps.sendMedia(deps.feishuAppId(), deps.feishuSecret(), chat, kind, Number(q.searchParams.get('limit') ?? 3))
        .then(() => json(200, { ok: true }))
        .catch((e) => json(500, { detail: String(e?.message ?? e) }))
      return
    }
    if (pathname === '/api/analytics/platforms') {
      const plats = [['douyin', '抖音'], ['xiaohongshu', '小红书'], ['bilibili', 'B站'], ['kuaishou', '快手'], ['shipinhao', '视频号']]
      return json(200, plats.map(([platform, label]) => {
        const st = deps.readLoginStatus(platform)
        return { platform, label, loggedIn: st.state === 'success' }
      }))
    }
    if (pathname === '/api/analytics/account') {
      const platform = new URL(String(req.url ?? '/'), 'http://x').searchParams.get('platform') ?? 'douyin'
      deps.fetchAccountStats(platform).then((d) => json(200, d)).catch((e) => json(500, { detail: String(e?.message ?? e) }))
      return
    }
    if (pathname === '/api/accounts' && req.method === 'GET') {
      const platforms = ['douyin', 'xiaohongshu', 'bilibili', 'kuaishou', 'shipinhao']
      return json(200, platforms.map((p) => {
        const st = deps.readLoginStatus(p)
        return { platform: p, name: st.name ?? p, loggedIn: st.state === 'success', status: st.state, message: st.message ?? '' }
      }))
    }
    const al = /^\/api\/accounts\/([^/]+)\/(login|status|sms|whoami)$/.exec(pathname)
    if (al) {
      const platform = al[1]; const action = al[2]
      if (action === 'login' && req.method === 'POST') return json(200, deps.startLogin(platform))
      if (action === 'status') return json(200, deps.readLoginStatus(platform))
      if (action === 'whoami') { deps.startWhoami(platform).then((r) => json(200, r)); return }
      if (action === 'sms' && req.method === 'POST') {
        let b = ''; req.on('data', (c) => { b += c }); req.on('end', () => {
          try { const code = String(JSON.parse(b || '{}').code ?? ''); writeFileSync(join(deps.loginDir(), `${platform}.code`), code); json(200, { ok: true }) } catch (e) { json(400, { detail: String(e?.message ?? e) }) }
        }); return
      }
    }
    if (pathname === '/api/sessions' && req.method === 'GET') {
      const f = join(ROOT, 'outputs', '_sessions', 'web.json')
      return json(200, { sessions: existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')).sessions ?? []) : [] })
    }
    if (pathname === '/api/sessions' && req.method === 'PUT') {
      let b = ''; req.on('data', (c) => { b += c }); req.on('end', () => {
        try { const d = JSON.parse(b || '{}'); mkdirSync(join(ROOT, 'outputs', '_sessions'), { recursive: true }); writeFileSync(join(ROOT, 'outputs', '_sessions', 'web.json'), JSON.stringify({ sessions: d.sessions ?? [], updated: Date.now() })); json(200, { ok: true }) } catch (e) { json(400, { detail: String(e?.message ?? e) }) }
      }); return
    }
    if (pathname === '/api/settings/harness' && req.method === 'GET') {
      return json(200, { runtime: 'dsh', models: { 'deepseek-official': 'deepseek-v4-flash' }, sandbox: 'workspace-write', codex_auto_approve: false, locked: false, agents: [] })
    }
    if (pathname === '/api/settings/harness/models/dsh' && req.method === 'POST') {
      return json(200, { runtime: 'dsh', models: [{ id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', default: true }, { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', default: false }] })
    }
    if (pathname === '/api/env/tools') {
      return json(200, { python: process.env.PYTHON ?? 'python3', tools: [], cachedAt: Date.now() })
    }
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
    const rel = pathname.slice('/avatar/app/'.length)
    const direct = join(distDir, rel)
    if (rel && !rel.endsWith('/') && existsSync(direct) && statSync(direct).isFile()) {
      const ext = direct.slice(direct.lastIndexOf('.')).toLowerCase()
      const mime = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' }[ext] ?? 'application/octet-stream'
      res.writeHead(200, { 'content-type': mime }); res.end(readFileSync(direct)); return
    }
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


  function personaText() {
    const name = process.env.AVATAR_PROFILE ?? 'haoge'
    const dir = join(ROOT, 'profiles', name)
    const parts = []
    if (existsSync(dir)) {
      for (const f of ['identity.md', 'style.md', 'audience.md', 'platforms.md', 'preferences.md', 'memory.md']) {
        const p = join(dir, f)
        if (existsSync(p)) parts.push(readFileSync(p, 'utf8'))
      }
    }
    const head = '你是 Avatar 的主编（常驻数字员工），不是 Easel，也不是通用编程助手。你服务的账号是「浩哥侃球」（抖音 NBA 篮球解说）。你的工作：定选题、写脚本、做视频、发布、看数据、复盘。回答用中文，简洁、直接、像同事。'
    return [head, ...parts].join('\n\n')
  }
  function installPersona(agentCtx) {
    try { agentCtx.systemPrompt.section({ name: 'avatar/persona', order: 0, text: personaText() }) } catch (e) { /* ignore */ }
  }

  async function ensureAgent(sid) {
    let handle = agents.get(sid)
    if (handle) return handle
    const presets = ctx.get('agentPresets')
    let presetId
    let setup
    if (presets) {
      presetId = (await presets.resolve(undefined)).id
      setup = async (agentCtx) => { await presets.mount(agentCtx, presetId); installPersona(agentCtx) }
    }
    const live = ctx.agents.get?.(sid)
    if (live) { const h = { agent: live, dispose: async () => {} }; agents.set(sid, h); return h }
    try {
      handle = await ctx.agents.create({
        sessionId: sid,
        agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
        meta: { cwd: process.cwd(), ...(presetId ? { agentPreset: presetId } : {}) },
        ...(setup ? { setup } : {}),
      })
    } catch (e) {
      if (!/already exists/i.test(String(e?.message ?? e))) throw e
      handle = await ctx.agents.resume({ resumeSessionId: sid, agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' }, ...(setup ? { setup } : {}) })
    }
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


  for (const p of ['/api/status', '/api/skills', '/api/outputs', '/api/templates', '/api/templates/', '/api/agentd', '/api/sessions', '/api/artifacts', '/api/media', '/api/output', '/api/accounts', '/api/chat', '/api/personas', '/api/persona', '/api/upload', '/api/settings', '/api/env', '/api/analytics', '/api/rsi', '/api/meter', '/api/steps', '/api/feishu']) {
    ctx.effect(() => ctx.webServer.register({
      kind: ['/api/media', '/api/output', '/api/templates', '/api/agentd', '/api/sessions', '/api/artifacts', '/api/accounts', '/api/chat', '/api/personas', '/api/persona', '/api/upload', '/api/settings', '/api/env', '/api/analytics', '/api/rsi', '/api/meter', '/api/steps', '/api/feishu'].includes(p) ? 'prefix' : 'exact',
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



  const loginDir = () => join(ROOT, 'outputs', '_login')
  const loginStatusFile = (platform) => join(loginDir(), `${platform}.login.json`)
  function readLoginStatus(platform) {
    try { return JSON.parse(readFileSync(loginStatusFile(platform), 'utf8')) } catch { return { state: 'unknown', message: '' } }
  }
  function startLogin(platform) {
    const py = process.env.PYTHON ?? 'python3'
    const script = join(ROOT, 'skills', 'shared', 'scripts', 'douyin_publish.py')
    mkdirSync(loginDir(), { recursive: true })
    const qr = join(loginDir(), `${platform}.png`)
    const st = join(loginDir(), `${platform}.login.json`)
    const child = spawn(py, [script, 'login', '--qr-out', qr, '--status-file', st, '--timeout', '600'], { cwd: ROOT, env: process.env, detached: true, stdio: 'ignore' })
    child.unref()
    return { started: true, platform, qr: `/api/media/_login/${platform}.png`, status: `/api/avatar/accounts/${platform}/status` }
  }
  function startWhoami(platform) {
    return new Promise((resolve) => {
      const py = process.env.PYTHON ?? 'python3'
      const script = join(ROOT, 'skills', 'shared', 'scripts', 'douyin_publish.py')
      const child = spawn(py, [script, 'whoami'], { cwd: ROOT, env: process.env })
      let out = ''
      child.stdout.on('data', (d) => { out += d }); child.stderr.on('data', (d) => { out += d })
      child.on('close', () => { try { resolve(JSON.parse(out.trim().split('\n').pop())) } catch { resolve({ loggedIn: false }) } })
    })
  }



  function snapshotTemplate(templateId) {
    const tdir = join(ROOT, 'templates', templateId)
    const vdir = join(tdir, 'versions', String(Date.now()))
    mkdirSync(vdir, { recursive: true })
    for (const f of ['template.json', 'playbook.md', 'checklist.md', 'skeleton.json']) {
      const src = join(tdir, f)
      if (existsSync(src)) writeFileSync(join(vdir, f), readFileSync(src))
    }
    return vdir
  }
  function listTemplateVersions(templateId) {
    const vdir = join(ROOT, 'templates', templateId, 'versions')
    if (!existsSync(vdir)) return []
    return readdirSync(vdir).filter((n) => /^\d+$/.test(n)).sort((a, b) => Number(b) - Number(a))
  }

  const analyticsCache = new Map()
  function fetchAccountStats(platform) {
    const key = platform
    const hit = analyticsCache.get(key)
    if (hit && Date.now() - hit.at < 5 * 60000) return Promise.resolve(hit.data)
    return new Promise((resolve) => {
      const py = process.env.PYTHON ?? 'python3'
      const script = join(ROOT, 'skills', 'shared', 'scripts', 'account_stats.py')
      const child = spawn(py, [script, 'fetch', '--platform', platform], { cwd: ROOT, env: process.env })
      let out = ''
      child.stdout.on('data', (d) => { out += d }); child.stderr.on('data', (d) => { out += d })
      child.on('close', () => {
        let data = {}
        try { data = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)) } catch { data = { platform, loggedIn: false, error: out.slice(-300) } }
        analyticsCache.set(key, { at: Date.now(), data })
        resolve(data)
      })
    })
  }


  function diagnose(templateId) {
    const baseDir = join(ROOT, 'outputs', '_runs')
    const out = { total: 0, done: 0, failed: 0, avgScore: 0, reviseRate: 0, byTemplate: {} }
    if (!existsSync(baseDir)) return out
    const scores = []; let revised = 0
    for (const d of readdirSync(baseDir)) {
      const f = join(baseDir, d, 'state.json')
      if (!existsSync(f)) continue
      let st; try { st = JSON.parse(readFileSync(f, 'utf8')) } catch { continue }
      if (templateId && st.templateId !== templateId) continue
      out.total += 1
      if (st.status === 'done') out.done += 1
      if (st.status === 'failed') out.failed += 1
      if (st.critic?.score) scores.push(st.critic.score)
      if ((st.reviseCount ?? 0) > 0) revised += 1
      if (st.templateId) { const t = out.byTemplate[st.templateId] ??= { total: 0, done: 0 }; t.total += 1; if (st.status === 'done') t.done += 1 }
    }
    out.avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0
    out.reviseRate = out.total ? Math.round((revised / out.total) * 100) : 0
    return out
  }

  async function propose(templateId) {
    const t = getTemplate(templateId)
    if (!t) throw new Error('模板不存在')
    const diag = diagnose(templateId)
    const prompt = [
      `你是内容方法论专家。基于诊断改进模板「${t.id}」。`,
      `诊断：${JSON.stringify(diag)}`,
      `当前手册：\n${(t.playbook ?? '').slice(0, 3000)}`,
      `当前清单：\n${(t.checklist ?? '').slice(0, 1500)}`,
      '输出 JSON：{"title":"提议标题","rationale":"为什么","changes":[{"file":"playbook.md|checklist.md","content":"完整新内容"}]}',
    ].join('\n')
    const text = await runAgentOnce(ctx, prompt, { timeoutMs: 120000 })
    let prop; try { prop = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) } catch { throw new Error('模型未返回有效 JSON') }
    const id = `${templateId}-${Date.now()}`
    const dir = join(ROOT, 'templates', '_rsi')
    mkdirSync(dir, { recursive: true })
    const record = { id, templateId, title: prop.title ?? '提议', rationale: prop.rationale ?? '', changes: prop.changes ?? [], status: 'draft', createdAt: Date.now() }
    writeFileSync(join(dir, `${id}.json`), JSON.stringify(record, null, 2))
    return record
  }

  function listProposals() {
    const dir = join(ROOT, 'templates', '_rsi')
    if (!existsSync(dir)) return []
    return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => { try { return JSON.parse(readFileSync(join(dir, f), 'utf8')) } catch { return null } }).filter(Boolean).sort((a, b) => b.createdAt - a.createdAt)
  }

  function applyProposal(id) {
    const dir = join(ROOT, 'templates', '_rsi')
    const f = join(dir, `${id}.json`)
    if (!existsSync(f)) throw new Error('提议不存在')
    const prop = JSON.parse(readFileSync(f, 'utf8'))
    const tdir = join(ROOT, 'templates', prop.templateId)
    if (!existsSync(tdir)) throw new Error('模板不存在')
    const vdir = join(tdir, 'versions', String(Date.now()))
    mkdirSync(vdir, { recursive: true })
    for (const c of prop.changes ?? []) {
      const target = join(tdir, c.file)
      if (existsSync(target)) writeFileSync(join(vdir, c.file), readFileSync(target))
      writeFileSync(target, String(c.content ?? ''))
    }
    prop.status = 'applied'; prop.appliedAt = Date.now()
    writeFileSync(f, JSON.stringify(prop, null, 2))
    return prop
  }

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
        const guard = setTimeout(() => { if (!closed) { closed = true; try { write(0, 'error', '响应超时（可能卡在工具调用），请重发') } catch {} ; try { res.end() } catch {} } }, 6 * 60000)
        const finish = () => { if (!closed) { closed = true; clearTimeout(guard); write(0, 'done', { sessionKey: sid }); res.end() } }
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
            if (r?.kind === 'error') { clearTimeout(guard); write(5, 'error', String(r.error?.message ?? '执行失败')); closed = true; res.end() }
            else finish()
          }
        }
        set.add(fn)
        res.on('close', () => { clearTimeout(guard); set.delete(fn) })
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

  const deps = { get agentd() { return agentd }, chatStream, chatStop, readLoginStatus, startLogin, startWhoami, loginDir, fetchAccountStats, feishuEvent, get feishuAppId() { return feishuAppId }, get feishuSecret() { return feishuSecret }, sendMedia, diagnose, propose, listProposals, applyProposal, usageSummary, stepsSummary, snapshotTemplate, listTemplateVersions, get runs() { return runs } }


  const stepsFile = () => join(ROOT, 'outputs', '_steps', '_all.jsonl')
  const meterFile = () => join(ROOT, 'outputs', '_meter', 'usage.jsonl')
  const appendLine = (f, obj) => { try { mkdirSync(join(f, '..'), { recursive: true }); appendFileSync(f, JSON.stringify(obj) + '\n') } catch {} }
  ctx.on('session/event', (session, ev) => {
    const sid = String(session?.id ?? session)
    if (ev?.type === 'tool/call') appendLine(stepsFile(), { ts: Date.now(), session: sid, tool: ev.data?.name ?? ev.data?.tool ?? 'tool', state: 'call' })
    else if (ev?.type === 'tool/result') appendLine(stepsFile(), { ts: Date.now(), session: sid, state: 'result', ok: !ev.data?.error })
    else if (ev?.type === 'assistant/message') {
      const u = ev.data?.usage
      if (u) appendLine(meterFile(), { ts: Date.now(), session: sid, model: ev.data?.message?.source?.model ?? '', usage: u })
    }
  })
  function usageSummary() {
    const out = { requests: 0, inputTokens: 0, outputTokens: 0, byModel: {} }
    const f = meterFile()
    if (existsSync(f)) {
      for (const line of readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
        try {
          const r = JSON.parse(line); const u = r.usage ?? {}
          out.requests += 1
          out.inputTokens += Number(u.inputTokens ?? u.input_tokens ?? u.prompt_tokens ?? 0)
          out.outputTokens += Number(u.outputTokens ?? u.output_tokens ?? u.completion_tokens ?? 0)
          const m = r.model || 'unknown'; out.byModel[m] = out.byModel[m] ?? { requests: 0, tokens: 0 }
          out.byModel[m].requests += 1; out.byModel[m].tokens += Number(u.inputTokens ?? u.input_tokens ?? 0) + Number(u.outputTokens ?? u.output_tokens ?? 0)
        } catch {}
      }
    }
    return out
  }
  function stepsSummary(limit = 50) {
    const f = stepsFile()
    if (!existsSync(f)) return []
    return readFileSync(f, 'utf8').split('\n').filter(Boolean).slice(-limit).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  }


  const feishuAppId = () => process.env.FEISHU_APP_ID ?? ''
  const feishuSecret = () => process.env.FEISHU_APP_SECRET ?? ''
  const feishuSeen = new Set()
  function feishuEvent(req, res) {
    let b = ''; req.on('data', (c) => { b += c })
    req.on('end', async () => {
      try { const body = JSON.parse(b || '{}'); const out = await feishuHandleEvent(body); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(out)) }
      catch { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}') }
    })
  }


  function mediaFiles() {
    const out = { video: [], image: [], audio: [] }
    const walk = (list) => {
      for (const n of list) {
        if (n.type === 'file') { const k = n.kind || (/\.(mp4|mov|webm)$/i.test(n.name) ? 'video' : /\.(png|jpe?g|webp)$/i.test(n.name) ? 'image' : /\.(mp3|wav|m4a)$/i.test(n.name) ? 'audio' : 'other'); if (out[k]) out[k].push(n) }
        if (n.children) walk(n.children)
      }
    }
    walk(listOutputTree())
    for (const k of Object.keys(out)) out[k].sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0))
    return out
  }
  async function sendMedia(appId, secret, chatId, kind, limit = 3) {
    const files = mediaFiles()[kind].slice(0, limit)
    if (!files.length) { await sendText(appId, secret, chatId, `暂无${kind}文件`); return }
    for (const f of files) {
      const abs = join(ROOT, 'outputs', f.path)
      if (!existsSync(abs)) continue
      const buf = readFileSync(abs)
      if (kind === 'image') {
        const key = await uploadImage(appId, secret, buf, f.name)
        await sendPayload(appId, secret, chatId, 'image', { image_key: key })
      } else if (kind === 'video') {
        const key = await uploadFile(appId, secret, buf, f.name, 'mp4')
        await sendPayload(appId, secret, chatId, 'media', { file_key: key, file_name: f.name })
      } else {
        const key = await uploadFile(appId, secret, buf, f.name, 'stream')
        await sendPayload(appId, secret, chatId, 'file', { file_key: key, file_name: f.name })
      }
    }
  }

  async function feishuHandleEvent(body) {
    try { appendFileSync(join(ROOT, 'outputs', '_feishu', 'events.jsonl'), JSON.stringify({ ts: Date.now(), type: body?.type ?? body?.header?.event_type, hasMsg: Boolean(body?.event?.message), evType: body?.header?.event_type, content: String(body?.event?.message?.content ?? '').slice(0, 80) }) + '\n') } catch {}
    try { const m = body?.event?.message; appendFileSync(join(ROOT, 'outputs', '_feishu', 'handler.log'), JSON.stringify({ ts: Date.now(), phase: 'raw', chat: m?.chat_id, mid: m?.message_id, text: parseText(m).slice(0, 30) }) + '\n') } catch (e) { try { appendFileSync('/tmp/feishu-diag.err', String(e) + '\n') } catch {} }
    if (body?.type === 'url_verification') return { challenge: body.challenge }
    if (body?.header?.event_type === 'card.action.trigger') {
      const ev = body.event ?? {}
      const val = ev.action?.value ?? {}
      const chat = ev.context?.open_chat_id ?? ev.open_chat_id ?? ''
      const act = String(val.action ?? '')
      try {
        if (act === 'approve_plan') { agentd.approvePlan(); if (chat) await sendText(feishuAppId(), feishuSecret(), chat, '✅ 计划已批准，开始执行') ; return { toast: { type: 'success', content: '已批准' } } }
        if (act === 'reject_plan') { void agentd.generatePlan('用户打回了计划，请换一种安排'); if (chat) await sendText(feishuAppId(), feishuSecret(), chat, '已打回，正在重新生成计划') ; return { toast: { type: 'success', content: '已打回' } } }
        if (act === 'approve' || act === 'reject') {
          agentd.resolveCard(String(val.cardId ?? ''), act)
          if (chat) await sendText(feishuAppId(), feishuSecret(), chat, act === 'approve' ? '✅ 已通过' : '↩️ 已打回')
          return { toast: { type: 'success', content: act === 'approve' ? '已通过' : '已打回' } }
        }
      } catch (e) {
        return { toast: { type: 'error', content: String(e?.message ?? e) } }
      }
      return {}
    }
    const ev = body?.event
    const msg = ev?.message
    if (!msg || body?.header?.event_type !== 'im.message.receive_v1') return {}
    if (msg.message_id && feishuSeen.has(msg.message_id)) return {}
    if (msg.message_id) { feishuSeen.add(msg.message_id); if (feishuSeen.size > 2000) feishuSeen.clear() }
    if (String(msg.sender?.sender_type ?? '') === 'app') return {}
    const chatId = msg.chat_id
    const text = parseText(msg)
    if (!chatId || !text) return {}
    void (async () => {
      const flog = (o) => { try { appendFileSync(join(ROOT, 'outputs', '_feishu', 'handler.log'), JSON.stringify({ ts: Date.now(), ...o }) + '\n') } catch {} }
      flog({ step: 'enter', text: text.slice(0, 40), chatId })
      try {
        const appId = feishuAppId(); const secret = feishuSecret()
        if (!appId || !secret) return
        // 确定性命令：审批 / 状态
        if (/^(批准|通过计划|approve)$/i.test(text)) {
          try { agentd.approvePlan(); await sendText(appId, secret, chatId, '✅ 计划已批准，开始执行') } catch (e) { await sendText(appId, secret, chatId, `⚠️ 批准失败：${String(e?.message ?? e)}`) }
          return
        }
        if (/^(媒体|media)$/i.test(text)) {
          const m = mediaFiles()
          await sendText(appId, secret, chatId, `媒体库存量：视频 ${m.video.length}、图片 ${m.image.length}、音乐 ${m.audio.length}\n发「视频」「图片」「音乐」我直接发给你`)
          return
        }
        if (/^(视频|video)$/i.test(text)) { await sendMedia(appId, secret, chatId, 'video', 3); return }
        if (/^(图片|照片|image)$/i.test(text)) { await sendMedia(appId, secret, chatId, 'image', 6); return }
        if (/^(音乐|音频|audio)$/i.test(text)) { await sendMedia(appId, secret, chatId, 'audio', 3); return }
        if (/^(状态|status)$/i.test(text)) {
          flog({ step: 'status-branch' })
          const p = agentd.panel()
          const lines = [`模式：${p.mode}`, `计划：${p.plan ? `v${p.plan.version} ${p.plan.status}` : '无'}`, ...(p.plan?.items ?? []).slice(0, 6).map((it) => `${it.time} ${it.title}`), `待确认卡片：${p.cards.length}`]
          await sendText(appId, secret, chatId, lines.join('\n'))
          if (p.cards.length) {
            const card = approvalCard('待确认事项', p.cards.map((c) => `**${c.title}**\n${String(c.body ?? '').slice(0, 80)}`).join('\n\n'), p.cards.flatMap((c) => [
              { label: '通过', type: 'primary', value: { action: 'approve', cardId: c.id } },
              { label: '打回', type: 'danger', value: { action: 'reject', cardId: c.id } },
            ]))
            await sendCard(appId, secret, chatId, card)
          }
          if (p.plan && p.plan.status === 'draft') {
            await sendCard(appId, secret, chatId, approvalCard('计划待批准', p.plan.summary ?? '', [
              { label: '批准计划', type: 'primary', value: { action: 'approve_plan' } },
              { label: '打回重排', type: 'danger', value: { action: 'reject_plan' } },
            ]))
          }
          return
        }
        if (/^(计划|plan)$/i.test(text)) {
          const p = agentd.panel()
          await sendText(appId, secret, chatId, p.plan ? `计划 v${p.plan.version}（${p.plan.status}）\n` + p.plan.items.map((it) => `${it.time} ${it.title}`).join('\n') : '暂无计划，回复「生成计划」')
          return
        }
        if (/^(生成计划|regen)$/i.test(text)) { await sendText(appId, secret, chatId, '正在生成计划…'); void agentd.generatePlan(''); return }
        const m = /^(通过|打回)\s+(\S+)/.exec(text)
        if (m) {
          try { agentd.resolveCard(m[2], m[1] === '通过' ? 'approve' : 'reject'); await sendText(appId, secret, chatId, `已${m[1]}：${m[2]}`) } catch (e) { await sendText(appId, secret, chatId, `操作失败：${String(e?.message ?? e)}`) }
          return
        }
        // 普通对话：走主编写会话
        const sid = 'feishu-' + chatId
        const handle = await ensureAgent(sid)
        let answer = ''
        const off = ctx.on('session/event', (se, e) => {
          if (String(se?.id) !== sid) return
          if (e.type === 'assistant/message') {
            const parts = e.data?.message?.content ?? []
            const t = parts.filter((x) => x.type === 'text').map((x) => x.text).join('')
            if (t) answer += (answer ? '\n' : '') + t
          }
        })
        handle.agent.followup({ id: String(Date.now()), role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } })
        await Promise.race([handle.agent.whenIdle(), new Promise((r) => setTimeout(r, 180000))])
        off()
        await sendText(appId, secret, chatId, answer || '（没有生成回复，请重试）')
      } catch (e) {
        flog({ step: 'error', message: String(e?.message ?? e) })
        try { await sendText(feishuAppId(), feishuSecret(), chatId, `出错了：${String(e?.message ?? e)}`) } catch (e2) { flog({ step: 'send-error', message: String(e2?.message ?? e2) }) }
      }
    })()
    return {}
  }

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
                installPersona(agentCtx)
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
        res.on('close', () => { clearInterval(hb); set.delete(fn) })
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
      if (u.pathname === '/api/feishu/event' && req.method === 'POST') {
        let b = ''; req.on('data', (c) => { b += c })
        req.on('end', async () => {
          try {
            const body = JSON.parse(b || '{}')
            const out = await feishuHandleEvent(body)
            res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(out))
          } catch (e) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({})) }
        })
        return
      }
      if (u.pathname === '/api/feishu/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, appId: Boolean(feishuAppId()) })); return }
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
