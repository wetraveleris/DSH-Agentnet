// 飞书（Lark）机器人桥：事件回调 → Avatar 主编；支持审批命令与普通对话
const TOKEN_URL = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal'
const SEND_URL = 'https://open.feishu.cn/open-apis/im/v1/messages'

let cache = { token: '', exp: 0 }

export async function tenantToken(appId, appSecret) {
  if (cache.token && Date.now() < cache.exp - 60000) return cache.token
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ app_id: appId, app_secret: appSecret }) })
  const d = await r.json()
  if (d.code !== 0) throw new Error(`飞书 token 失败：${d.code} ${d.msg}`)
  cache = { token: d.tenant_access_token, exp: Date.now() + (d.expire ?? 7200) * 1000 }
  return cache.token
}

export async function sendText(appId, appSecret, chatId, text) {
  const token = await tenantToken(appId, appSecret)
  const r = await fetch(`${SEND_URL}?receive_id_type=chat_id`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text }) }),
  })
  const d = await r.json()
  if (d.code !== 0) throw new Error(`飞书发消息失败：${d.code} ${d.msg}`)
  return d.data
}

export function parseText(event) {
  try {
    const c = JSON.parse(event?.message?.content ?? '{}')
    return String(c.text ?? '').trim()
  } catch { return '' }
}
