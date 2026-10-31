import { readFileSync, createReadStream, statSync, writeFileSync, existsSync, appendFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'avatar-ping'
export const inject = ['webServer', 'tools']

const here = dirname(fileURLToPath(import.meta.url))
const demo = join(here, 'demo.txt')

export function apply(ctx) {
  ctx.logger?.info?.('avatar-ping: apply')
  const evtLog = '/tmp/avatar-events.jsonl'
  try { ctx.on('session/event', (_s, e) => { try { appendFileSync(evtLog, JSON.stringify({ kind: e?.kind ?? e?.type ?? null, at: Date.now() }) + '\n') } catch {} }) } catch (e) { ctx.logger?.warn?.('avatar-ping: hook fail ' + e) }

  if (!existsSync(demo)) writeFileSync(demo, 'avatar range test '.repeat(200))

  // 1) 普通 JSON 路由
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: '/api/ping',
    handler: (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, from: 'avatar-ping', ts: Date.now() }))
    },
  }))

  // 2) SSE 流式
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: '/api/avatar/stream',
    handler: (req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
      let i = 0
      const t = setInterval(() => {
        i += 1
        res.write(`id: ${i}\nevent: tick\ndata: {"n":${i}}\n\n`)
        if (i >= 3) { clearInterval(t); res.end() }
      }, 200)
    },
  }))

  // 3) Range 静态文件
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: '/api/avatar/file',
    handler: (req, res) => {
      const st = statSync(demo)
      const range = req.headers.range
      if (!range) {
        res.writeHead(200, { 'content-type': 'text/plain', 'content-length': st.size, 'accept-ranges': 'bytes' })
        createReadStream(demo).pipe(res); return
      }
      const m = /bytes=(\d*)-(\d*)/.exec(range)
      const start = m?.[1] ? parseInt(m[1], 10) : 0
      const end = m?.[2] ? parseInt(m[2], 10) : st.size - 1
      res.writeHead(206, { 'content-type': 'text/plain', 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': end - start + 1 })
      createReadStream(demo, { start, end }).pipe(res)
    },
  }))

  // 5) 工具自检路由
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: '/api/avatar/tools',
    handler: (_req, res) => {
      const t = ctx.tools.get('avatar_ping')
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ registered: Boolean(t), description: t?.description ?? null }))
    },
  }))

  // 4) 工具注册
  ctx.effect(() => {
    const tool = {
      name: 'avatar_ping',
      description: 'Avatar spike tool: echo a message and report the plugin is alive.',
      parameters: { message: { type: 'string', required: true, description: 'text to echo' } },
      output: { schema: { type: 'object' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
      async execute(args) { return { ok: true, echo: String(args?.message ?? ''), plugin: 'avatar-ping' } },
    }
    const dispose = ctx.tools.register(tool)
    ctx.logger?.info?.('avatar-ping: tool registered')
    return () => dispose?.()
  })
}
