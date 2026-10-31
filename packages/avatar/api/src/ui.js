export function dashboardHtml() {
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Avatar</title>
<style>
:root{--bg:#0b0b0d;--panel:#141417;--line:#26262c;--text:#e8e6e3;--muted:#9a9aa2;--red:#e8492f}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.6 -apple-system,"PingFang SC",sans-serif}
header{display:flex;align-items:center;gap:16px;padding:12px 20px;border-bottom:1px solid var(--line);position:sticky;top:0;background:rgba(11,11,13,.92);backdrop-filter:blur(8px);z-index:5}
h1{font-size:15px;margin:0;letter-spacing:.06em}nav{display:flex;gap:4px;flex-wrap:wrap}
nav a{color:var(--muted);text-decoration:none;font-size:13px;padding:4px 10px;border-radius:8px}
nav a.on{color:var(--text);background:#1c1c22}main{padding:18px 20px;max-width:1080px;margin:0 auto}
.grid{display:grid;grid-template-columns:1.25fr 1fr;gap:14px}@media(max-width:820px){.grid{grid-template-columns:1fr}}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px;margin-bottom:12px}
.card h2{font-size:12px;color:var(--muted);font-weight:500;margin:0 0 8px;letter-spacing:.05em}
.row{display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px dashed rgba(255,255,255,.06);font-size:13px}
.row:last-child{border-bottom:0}.tag{color:var(--muted);font-size:11.5px}
.done{color:#3cba6a}.running{color:#e8b93f}.pending{color:var(--muted)}.failed{color:var(--red)}
button{font:inherit;cursor:pointer;border-radius:8px;border:1px solid var(--line);background:#1b1b20;color:var(--text);padding:5px 11px;font-size:12.5px}
button.primary{border-color:rgba(232,73,47,.5);color:#ff8a7a}button.ok{border-color:rgba(60,186,106,.5);color:#3cba6a}
#log{white-space:pre-wrap;font-size:13px;max-height:300px;overflow:auto}
#ask{display:flex;gap:8px;margin-top:10px}#ask input{flex:1;background:#0f0f12;border:1px solid var(--line);color:var(--text);border-radius:8px;padding:8px 10px}
.muted{color:var(--muted);font-size:12px}
</style></head><body>
<header><h1>AVATAR</h1><nav>
<a href="#/main" data-v="main">主编</a><a href="#/templates" data-v="templates">模板</a><a href="#/skills" data-v="skills">技能</a>
<a href="#/outputs" data-v="outputs">内容</a><a href="#/accounts" data-v="accounts">账号</a><a href="#/profiles" data-v="profiles">画像</a>
</nav></header><main id="view"></main>
<script>
const $ = (s) => document.querySelector(s)
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))
let sid = localStorage.getItem('avatar-session') || ''
const view = () => (location.hash.replace('#/','') || 'main')
function nav() { document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('on', a.dataset.v === view())) }
async function j(u) { const r = await fetch(u); return r.json() }
function mainView() {
  $('#view').innerHTML = '<div class="grid"><div>' +
    '<div class="card"><h2>今日计划</h2><div id="plan" class="muted">加载中…</div></div>' +
    '<div class="card"><h2>任务</h2><div id="jobs" class="muted">加载中…</div></div>' +
    '<div class="card"><h2>待确认</h2><div id="cards" class="muted">加载中…</div></div>' +
    '<div class="card"><h2>动态</h2><div id="events" class="muted" style="max-height:180px;overflow:auto"></div></div>' +
    '</div><div><div class="card"><h2>对话</h2><div id="log"></div><div id="ask"><input id="msg" placeholder="给主编发消息…"/><button class="primary" onclick="send()">发送</button></div></div></div></div>'
  panel(); if (!window.__es) { window.__es = new EventSource('/api/avatar/events'); window.__es.onmessage = (m) => { let d; try { d = JSON.parse(m.data) } catch { return }; const box = document.getElementById('events'); if (!box) return; const line = document.createElement('div'); line.className='row'; line.innerHTML = '<span class="tag">' + new Date(d.ts).toTimeString().slice(0,5) + '</span><span>' + esc((d.event||'') + ' ' + (d.title||'')) + '</span>'; box.prepend(line); while (box.children.length > 30) box.lastChild.remove(); if (d.event === 'job.done' || d.event === 'job.failed') panel() } }
}
async function panel() {
  if (view() !== 'main') return
  const d = await j('/api/avatar/agentd/panel')
  const meta = document.getElementById('meta'); if (meta) meta.textContent = d.mode
  const p = d.plan
  const plan = document.getElementById('plan'); if (!plan) return
  plan.innerHTML = p ? ('<div class="row"><b>v' + p.version + ' · ' + esc(p.status) + '</b><span class="tag">' + esc(p.summary).slice(0,46) + '</span></div>' + p.items.map((it) => '<div class="row"><span class="tag">' + it.time + '</span><span>' + esc(it.title).slice(0,30) + '</span><span class="tag">' + it.type + '</span></div>').join('') + (p.status === 'draft' ? '<div style="margin-top:10px"><button class="ok" onclick="approve()">批准开工</button> <button onclick="regen()">重新生成</button></div>' : '')) : '<span class="muted">暂无计划</span>'
  document.getElementById('jobs').innerHTML = d.jobs.length ? d.jobs.map((x) => '<div class="row"><span class="tag">' + x.at + '</span><span>' + esc(x.title).slice(0,34) + '</span><span class="' + x.state + '">' + x.state + '</span></div>').join('') : '<span class="muted">暂无任务</span>'
  document.getElementById('cards').innerHTML = d.cards.length ? d.cards.map((c) => '<div class="row"><span>' + esc(c.title).slice(0,28) + '</span><span><button class="ok" onclick="resolve(\\'' + c.id + '\\',\\'approve\\')">通过</button> <button onclick="resolve(\\'' + c.id + '\\',\\'reject\\')">打回</button></span></div>').join('') : '<span class="muted">无</span>'
}
async function approve(){ await fetch('/api/avatar/agentd/plan/approve',{method:'POST'}); panel() }
async function regen(){ await fetch('/api/avatar/agentd/plan/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}); panel() }
async function resolve(id, action){ await fetch('/api/avatar/agentd/cards/'+encodeURIComponent(id)+'/resolve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action})}); panel() }
async function send() {
  const text = document.getElementById('msg').value.trim(); if (!text) return
  document.getElementById('msg').value = ''; document.getElementById('log').textContent += '\\n你：' + text + '\\n主编：'
  const r = await fetch('/api/avatar/ask', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ message: text, sessionId: sid || undefined }) })
  const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = ''
  while (true) {
    const { value, done } = await reader.read(); if (done) break
    buf += dec.decode(value, { stream: true }); const parts = buf.split('\\n\\n'); buf = parts.pop() || ''
    for (const pt of parts) { if (!pt.startsWith('data: ')) continue; const ev = JSON.parse(pt.slice(6)); const log = document.getElementById('log'); if (!log) return
      if (ev.type === 'token' || ev.type === 'message') log.textContent += ev.text
      else if (ev.type === 'error') log.textContent += '\\n[错误] ' + ev.message
      else if (ev.type === 'done' && ev.sessionId) { sid = ev.sessionId; localStorage.setItem('avatar-session', sid) } }
  }
  const log = document.getElementById('log'); if (log) log.scrollTop = log.scrollHeight
}
async function templatesView() {
  const d = await j('/api/avatar/templates')
  $('#view').innerHTML = '<div class="card"><h2>模板（' + d.templates.length + '）</h2>' + d.templates.map((t) => '<div class="row"><span><b>' + esc(t.name) + '</b> <span class="tag">' + t.id + '</span></span><span class="tag">v' + t.version + ' · ' + (t.stages||[]).join(' → ') + '</span></div>').join('') + '</div>'
}
async function skillsView() {
  const d = await j('/api/avatar/skills')
  $('#view').innerHTML = '<div class="card"><h2>技能（' + d.skills.length + '）</h2>' + d.skills.map((s) => '<div class="row"><span><b>' + esc(s.id) + '</b><div class="muted">' + esc(s.description) + '</div></span></div>').join('') + '</div>'
}
async function outputsView() {
  const d = await j('/api/avatar/outputs')
  $('#view').innerHTML = '<div class="card"><h2>内容（' + d.outputs.length + '）</h2>' + d.outputs.map((o) => '<div class="row"><span class="tag">' + new Date(o.mtime).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) + '</span><span>' + esc(o.path) + '</span><span class="tag">' + (o.size/1024/1024).toFixed(1) + 'MB</span></div>').join('') + '</div>'
}
async function accountsView() {
  const d = await j('/api/avatar/accounts')
  $('#view').innerHTML = '<div class="card"><h2>账号状态（' + d.accounts.length + '）</h2>' + (d.accounts.length ? d.accounts.map((a) => '<div class="row"><span><b>' + esc(a.file) + '</b></span><span class="tag">' + esc(a.state) + ' · ' + esc(a.message) + '</span></div>').join('') : '<span class="muted">暂无登录状态记录</span>') + '</div>'
}
async function profilesView() {
  const d = await j('/api/avatar/profiles')
  $('#view').innerHTML = '<div class="card"><h2>画像（' + d.profiles.length + '）</h2>' + d.profiles.map((p) => '<div class="row"><span>' + esc(p.name) + '</span><span class="tag">' + (p.dir ? '目录' : (p.size/1024).toFixed(1) + 'KB') + '</span></div>').join('') + '</div>'
}
function render() {
  nav()
  const v = view()
  if (v === 'templates') templatesView()
  else if (v === 'skills') skillsView()
  else if (v === 'outputs') outputsView()
  else if (v === 'accounts') accountsView()
  else if (v === 'profiles') profilesView()
  else mainView()
}
window.addEventListener('hashchange', render)
render(); setInterval(() => { if (view() === 'main') panel() }, 8000)
</script></body></html>`
}
