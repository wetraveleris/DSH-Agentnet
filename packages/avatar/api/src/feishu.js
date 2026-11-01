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

export function parseText(eventOrMessage) {
  try {
    const raw = eventOrMessage?.message?.content ?? eventOrMessage?.content ?? '{}'
    const c = JSON.parse(raw)
    return String(c.text ?? '').trim()
  } catch { return '' }
}

const IMG_URL = 'https://open.feishu.cn/open-apis/im/v1/images'
const FILE_URL = 'https://open.feishu.cn/open-apis/im/v1/files'

export async function uploadImage(appId, appSecret, buffer, filename) {
  const token = await tenantToken(appId, appSecret)
  const fd = new FormData()
  fd.append('image_type', 'message')
  fd.append('image', new Blob([buffer]), filename)
  const r = await fetch(IMG_URL, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: fd })
  const d = await r.json()
  if (d.code !== 0) throw new Error(`上传图片失败：${d.code} ${d.msg}`)
  return d.data.image_key
}

export async function uploadFile(appId, appSecret, buffer, filename, fileType) {
  const token = await tenantToken(appId, appSecret)
  const fd = new FormData()
  fd.append('file_type', fileType)
  fd.append('file_name', filename)
  fd.append('file', new Blob([buffer]), filename)
  const r = await fetch(FILE_URL, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: fd })
  const d = await r.json()
  if (d.code !== 0) throw new Error(`上传文件失败：${d.code} ${d.msg}`)
  return d.data.file_key
}

export async function sendPayload(appId, appSecret, chatId, msgType, content) {
  const token = await tenantToken(appId, appSecret)
  const r = await fetch(`${SEND_URL}?receive_id_type=chat_id`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ receive_id: chatId, msg_type: msgType, content: JSON.stringify(content) }),
  })
  const d = await r.json()
  if (d.code !== 0) throw new Error(`发送失败：${d.code} ${d.msg}`)
  return d.data
}

export async function sendCard(appId, appSecret, chatId, card) {
  return sendPayload(appId, appSecret, chatId, 'interactive', card)
}

export function approvalCard(title, body, buttons) {
  return {
    config: { wide_screen_mode: true },
    header: { template: 'blue', title: { tag: 'plain_text', content: title } },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: body } },
      { tag: 'action', actions: buttons.map((b) => ({ tag: 'button', text: { tag: 'plain_text', content: b.label }, type: b.type ?? 'default', value: b.value })) },
    ],
  }
}
