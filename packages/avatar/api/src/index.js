import { randomUUID } from 'node:crypto'
import { appendFileSync } from 'node:fs'

const AGENT_LIB = 'file:///Users/traveler/Desktop/deepseek%20harness独立仓库/packages/core/agent/lib/index.js'
let installModelSelection
await import(AGENT_LIB).then((m) => { installModelSelection = m.installModelSelection }).catch(() => {})

export const name = 'avatar-api'
export const inject = ['webServer', 'tools', 'agents']
export function apply(ctx) {
  const subs = new Map()
  ctx.on('session/event', (session, event) => {
    if (process.env.AVATAR_DEBUG === '1') try { appendFileSync('/tmp/avatar-events.jsonl', JSON.stringify({ sid: String(session?.id ?? session), type: event?.type, data: JSON.stringify(event?.data ?? null).slice(0, 500) }) + '\n') } catch {}
    const set = subs.get(String(session?.id ?? session))
    if (!set) return
    for (const fn of set) { try { fn(event) } catch {} }
  })
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
            sid = 'avatar-' + randomUUID()
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
            const handle = await ctx.agents.create({
              sessionId: sid,
              agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
              meta: { cwd: process.cwd(), ...(presetId ? { agentPreset: presetId } : {}) },
              ...(setup ? { setup } : {}),
            })
            const set = new Set()
            subs.set(sid, set)
            const send = (obj) => res.write('data: ' + JSON.stringify(obj) + '\n\n')
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
                if (text) send({ type: 'message', text })
              } else if (t === 'tool/call') send({ type: 'step', name: e?.data?.name ?? e?.name ?? 'tool' })
              else if (t === 'tool/result') send({ type: 'stepResult' })
            })
            handle.agent.followup({
              id: randomUUID(), role: 'user',
              content: [{ type: 'text', text: String(payload.message ?? '') }],
              source: { kind: 'user' },
            })
            await handle.agent.whenIdle()
            send({ type: 'done', sessionId: sid })
            subs.delete(sid)
            res.end()
            await handle.dispose()
          } catch (err) {
            res.write('data: ' + JSON.stringify({ type: 'error', message: String(err?.message ?? err), sessionId: sid }) + '\n\n')
            res.end()
          }
        })
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
