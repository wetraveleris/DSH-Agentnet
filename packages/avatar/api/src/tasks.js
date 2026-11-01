// 任务编排：主编把需求变成任务图（DAG），执行器按依赖拓扑执行
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ROLES, ROLE_IDS } from './roles.js'

const ROOT = process.env.AVATAR_ROOT ?? process.cwd()
const tasksDir = () => join(ROOT, 'outputs', '_tasks')

function save(t) {
  mkdirSync(tasksDir(), { recursive: true })
  writeFileSync(join(tasksDir(), `${t.id}.json`), JSON.stringify(t, null, 2))
}
function load(id) {
  const f = join(tasksDir(), `${id}.json`)
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null
}
function list() {
  const d = tasksDir()
  if (!existsSync(d)) return []
  return readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => { try { return JSON.parse(readFileSync(join(d, f), 'utf8')) } catch { return null } }).filter(Boolean).sort((a, b) => b.createdAt - a.createdAt)
}

export function attachTasks(runAgent) {
  async function plan(request) {
    const prompt = [
      '你是「浩哥侃球」的主编（Router）。把用户需求拆成任务图（DAG），但必须“最小化”：',
      '- 简单任务（问候、常识问答、改一句话、单次查询）→ 只给 1 个节点；',
      '- 需要多种技能才拆多节点；能并行就并行（互相无依赖）；',
      '- 审核节点只在有实质产物时加；',
      '- 每个节点写清 goal、role、inputs（依赖节点 id）、acceptance（验收标准）。',
      `可用角色：${ROLE_IDS.join('、')}。`,
      `用户需求：${request}`,
      '只输出 JSON：{"summary":"一句话","nodes":[{"id":"n1","role":"generalist","goal":"...","inputs":[],"acceptance":"..."}]}',
    ].join('\n')
    const text = await runAgent(prompt, { timeoutMs: 90000 })
    let dag = null
    try { dag = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) } catch {}
    if (!dag || !Array.isArray(dag.nodes) || !dag.nodes.length) dag = { summary: request.slice(0, 60), nodes: [{ id: 'n1', role: 'generalist', goal: request, inputs: [], acceptance: '直接回答' }] }
    const seen = new Set()
    dag.nodes = dag.nodes.slice(0, 8).filter((n) => n && n.id && !seen.has(n.id) && seen.add(n.id)).map((n) => ({
      id: String(n.id), role: ROLES[n.role] ? n.role : 'generalist', goal: String(n.goal ?? ''),
      inputs: Array.isArray(n.inputs) ? n.inputs.map(String) : [], acceptance: String(n.acceptance ?? ''),
      state: 'pending', output: '', error: '',
    }))
    return dag
  }

  function readyNodes(t) {
    const done = new Set(t.nodes.filter((n) => n.state === 'done').map((n) => n.id))
    return t.nodes.filter((n) => n.state === 'pending' && n.inputs.every((i) => done.has(i)))
  }

  async function runNode(t, n) {
    const role = ROLES[n.role]
    const inputs = n.inputs.map((id) => t.nodes.find((x) => x.id === id)?.output ?? '').filter(Boolean)
    const prompt = [role.prompt, `任务：${n.goal}`, n.acceptance ? `验收标准：${n.acceptance}` : '', inputs.length ? `上游产物：\n${inputs.join('\n---\n').slice(0, 6000)}` : ''].filter(Boolean).join('\n\n')
    n.state = 'running'; save(t)
    try {
      const out = await runAgent(prompt, { timeoutMs: role.timeoutMs, tools: role.tools, reasoningEffort: role.reasoningEffort })
      n.output = String(out ?? '').trim(); n.state = 'done'
    } catch (e) {
      n.error = String(e?.message ?? e); n.state = 'failed'
    }
    save(t)
  }

  async function execute(id) {
    const t = load(id); if (!t) return
    t.status = 'running'; save(t)
    const maxRounds = 12
    for (let round = 0; round < maxRounds; round++) {
      const ready = readyNodes(t)
      const pending = t.nodes.filter((n) => n.state === 'pending')
      if (!pending.length) break
      if (!ready.length) { t.status = 'failed'; t.error = '依赖无法满足（可能有环或失败节点）'; save(t); return }
      await Promise.all(ready.map((n) => runNode(t, n)))
      const failed = t.nodes.find((n) => n.state === 'failed')
      if (failed && failed.role !== 'critic') { t.status = 'failed'; t.error = failed.error; save(t); return }
    }
    // 验收回退：critic 说“不通过/需修改” → 重跑上游产出节点一次，再复审
    const critic = t.nodes.find((n) => n.role === 'critic' && n.state === 'done')
    if (critic && /不通过|需修改|不合格|问题清单|退回/.test(critic.output) && !t.reworked) {
      const producer = t.nodes.filter((n) => n.state === 'done' && n.id !== critic.id && n.role !== 'critic').pop()
      if (producer) {
        t.reworked = true
        producer.rework = critic.output.slice(0, 1200)
        producer.state = 'pending'; producer.output = ''
        critic.state = 'pending'; critic.output = ''
        save(t)
        for (const n of [producer, critic]) await runNode(t, n)
      }
    }
    // 收集产物
    const since = t.createdAt
    const arts = []
    const walk = (d, depth) => {
      if (depth > 4 || !existsSync(d)) return
      for (const n of readdirSync(d)) {
        if (n.startsWith('_') || n === 'node_modules') continue
        const f = join(d, n); let st
        try { st = statSync(f) } catch { continue }
        if (st.isDirectory()) walk(f, depth + 1)
        else if (/\.(mp4|png|jpe?g|mp3|wav|srt)$/i.test(n) && st.size > 10 * 1024 && st.mtimeMs >= since - 5000) arts.push(f.slice(ROOT.length + 1))
      }
    }
    walk(join(ROOT, 'outputs'), 0)
    t.artifacts = arts.slice(0, 10)
    const failed = t.nodes.find((n) => n.state === 'failed')
    t.status = failed ? 'partial' : 'done'
    t.finishedAt = Date.now(); save(t)
  }

  return {
    list,
    get: load,
    async start(request) {
      const simple = request.length <= 28 && !/视频|脚本|剪辑|发布|调研|查一下|搜一下|写一个|做一个|分镜|素材/.test(request)
      const dag = simple
        ? { summary: request.slice(0, 40), nodes: [{ id: 'n1', role: 'generalist', goal: request, inputs: [], acceptance: '直接给出结果', state: 'pending', output: '', error: '' }] }
        : await plan(request)
      const t = { id: 'task-' + randomUUID().slice(0, 8), request, summary: dag.summary, nodes: dag.nodes, status: 'pending', createdAt: Date.now() }
      save(t)
      void execute(t.id)
      return t
    },
  }
}
