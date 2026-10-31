export function dashboardHtml() {
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Avatar · 主编</title>
<style>
:root{--bg:#0b0b0d;--panel:#141417;--line:#26262c;--text:#e8e6e3;--muted:#9a9aa2;--red:#e8492f}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.6 -apple-system,"PingFang SC",sans-serif}
.wrap{max-width:960px;margin:0 auto;padding:24px}
h1{font-size:18px;margin:0 0 4px}.sub{color:var(--muted);font-size:12px;margin-bottom:16px}
.grid{display:grid;grid-template-columns:1.2fr 1fr;gap:14px}@media(max-width:760px){.grid{grid-template-columns:1fr}}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px;margin-bottom:12px}
.card h2{font-size:13px;color:var(--muted);font-weight:500;margin:0 0 8px;letter-spacing:.04em}
.row{display:flex;justify-content:space-between;gap:8px;padding:4px 0;border-bottom:1px dashed rgba(255,255,255,.05);font-size:13px}
.row:last-child{border-bottom:0}.tag{font-size:11px;color:var(--muted)}
.done{color:#3cba6a}.running{color:#e8b93f}.pending{color:var(--muted)}.failed{color:var(--red)}
button{font:inherit;cursor:pointer;border-radius:8px;border:1px solid var(--line);background:#1b1b20;color:var(--text);padding:6px 12px}
button.primary{border-color:rgba(232,73,47,.5);color:#ff8a7a}
button.ok{border-color:rgba(60,186,106,.5);color:#3cba6a}
#log{white-space:pre-wrap;font-size:13px;max-height:260px;overflow:auto}
#ask{display:flex;gap:8px;margin-top:10px}#ask input{flex:1;background:#0f0f12;border:1px solid var(--line);color:var(--text);border-radius:8px;padding:8px 10px}
</style></head><body><div class="wrap">
<h1>Avatar · 主编</h1><div class="sub" id="meta">加载中…</div>
<div class="grid">
  <div>
    <div class="card"><h2>今日计划</h2><div id="plan"></div></div>
    <div class="card"><h2>任务</h2><div id="jobs"></div></div>
    <div class="card"><h2>待确认</h2><div id="cards"></div></div>
  </div>
  <div>
    <div class="card"><h2>对话</h2><div id="log"></div>
      <div id="ask"><input id="msg" placeholder="给主编发消息…"/><button class="primary" onclick="send()">发送</button></div>
    </div>
  </div>
</div></div>
<script>
let sid = localStorage.getItem('avatar-session') || ''
const $ = (id) => document.getElementById(id)
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))
async function panel() {
  const d = await (await fetch('/api/avatar/agentd/panel')).json()
  $('meta').textContent = d.mode === 'auto' ? '主编执行中 · ' + d.date : '我执行 · ' + d.date
  const p = d.plan
  $('plan').innerHTML = p ? ('<div class="row"><b>v' + p.version + ' · ' + p.status + '</b><span class="tag">' + esc(p.summary).slice(0,40) + '</span></div>' +
    p.items.map((it) => '<div class="row"><span class="tag">' + it.time + '</span><span>' + esc(it.title).slice(0,26) + '</span><span class="tag">' + it.type + '</span></div>').join('') +
    (p.status === 'draft' ? '<div style="margin-top:10px"><button class="ok" onclick="approve()">批准开工</button> <button onclick="regen()">重新生成</button></div>' : '')) : '<div class="tag">暂无计划</div>'
  $('jobs').innerHTML = d.jobs.length ? d.jobs.map((j) => '<div class="row"><span class="tag">' + j.at + '</span><span>' + esc(j.title).slice(0,30) + '</span><span class="' + j.state + '">' + j.state + '</span></div>').join('') : '<div class="tag">暂无任务</div>'
  $('cards').innerHTML = d.cards.length ? d.cards.map((c) => '<div class="row"><span>' + esc(c.title).slice(0,24) + '</span><span><button class="ok" onclick="resolve(\\'' + c.id + '\\',\\'approve\\')">通过</button> <button onclick="resolve(\\'' + c.id + '\\',\\'reject\\')">打回</button></span></div>').join('') : '<div class="tag">无</div>'
}
async function approve(){ await fetch('/api/avatar/agentd/plan/approve',{method:'POST'}); panel() }
async function regen(){ await fetch('/api/avatar/agentd/plan/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}); panel() }
async function resolve(id, action){ await fetch('/api/avatar/agentd/cards/'+encodeURIComponent(id)+'/resolve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action})}); panel() }
async function send() {
  const text = $('msg').value.trim(); if (!text) return
  $('msg').value = ''; $('log').textContent += '\\n你：' + text + '\\n主编：'
  const r = await fetch('/api/avatar/ask', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ message: text, sessionId: sid || undefined }) })
  const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = ''
  while (true) {
    const { value, done } = await reader.read(); if (done) break
    buf += dec.decode(value, { stream: true })
    const parts = buf.split('\\n\\n'); buf = parts.pop() || ''
    for (const p of parts) {
      if (!p.startsWith('data: ')) continue
      const ev = JSON.parse(p.slice(6))
      if (ev.type === 'token' || ev.type === 'message') $('log').textContent += ev.text
      else if (ev.type === 'thinking' && ev.text) $('log').textContent += '\\n（思考：' + ev.text.slice(0,60) + '…）\\n'
      else if (ev.type === 'done' && ev.sessionId) { sid = ev.sessionId; localStorage.setItem('avatar-session', sid) }
      else if (ev.type === 'error') $('log').textContent += '\\n[错误] ' + ev.message
    }
  }
  $('log').scrollTop = $('log').scrollHeight
}
panel(); setInterval(panel, 8000)
</script></body></html>`
}
