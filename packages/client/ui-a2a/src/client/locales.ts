/** `a2a` settings copy. */
export const zh = {
  nav: 'Agent 网络',
  title: 'Agent 网络',
  intro: '加入并查看远程 Agent 的能力。任务仍从首页发送，标准模式会按需调用已加入网络的 Agent。',
  agent: '远程 Agent',
  skillSearch: '按 Skill 搜索公网 Agent',
  skillPlaceholder: '例如 image-analysis',
  search: '搜索 Agent',
  chooseAgent: '选择 Agent',
  discover: '读取 Agent Card',
  skills: 'Skills',
  noSkills: '尚未读取 Agent Card',
  endpoint: 'Endpoint',
  directUpload: '支持直传',
  noDirectUpload: '不支持直传',
  error: '操作失败',
  noAgents: '没有配置远程 Agent',
  joinTitle: '加入公网 Agent 网络', joinIntro: '填写节点配置并保存；密钥只使用 credential 引用，不会写入设置。',
  agentId: '节点 ID', relayUrl: 'Relay URL', relayTokenRef: 'Relay Token 引用', registryUrl: 'Registry URL', registryTokenRef: 'Registry Token 引用', provider: '视觉模型 Provider', model: '视觉模型 ID', name: 'Agent 名称', description: '能力描述', join: '保存并加入', leave: '离开网络', saving: '保存中…', relaySecret: 'Relay Token（留空则保留已有值）', registrySecret: 'Registry Token（留空则保留已有值）', requiredJoinFields: '节点 ID 和 Relay URL 不能为空', invalidSkills: '能力卡 JSON 必须是数组',
} satisfies Record<string, string>

/** Keys shared by the A2A settings translations. */
export type A2AKey = keyof typeof zh

/** English A2A settings translations. */
export const en = {
  nav: 'Agent network',
  title: 'Agent network',
  intro: 'Join and inspect remote Agents. Send tasks from the main conversation; Standard mode can call Agents available on this network.',
  agent: 'Remote Agent',
  skillSearch: 'Search public Agents by Skill',
  skillPlaceholder: 'for example, image-analysis',
  search: 'Search Agents',
  chooseAgent: 'Choose an Agent',
  discover: 'Read Agent Card',
  skills: 'Skills',
  noSkills: 'Agent Card has not been read',
  endpoint: 'Endpoint',
  directUpload: 'Direct upload',
  noDirectUpload: 'No direct upload',
  error: 'Operation failed',
  noAgents: 'No remote Agents configured',
  joinTitle: 'Join the public Agent network', joinIntro: 'Save node settings; secrets use credential references and are never stored here.',
  agentId: 'Agent ID', relayUrl: 'Relay URL', relayTokenRef: 'Relay token reference', registryUrl: 'Registry URL', registryTokenRef: 'Registry token reference', provider: 'Vision model provider', model: 'Vision model id', name: 'Agent name', description: 'Capability description', join: 'Save and join', leave: 'Leave network', saving: 'Saving…', relaySecret: 'Relay token (blank keeps the stored value)', registrySecret: 'Registry token (blank keeps the stored value)', requiredJoinFields: 'Agent ID and Relay URL are required', invalidSkills: 'Agent Card JSON must be an array',
} satisfies Record<A2AKey, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { a2a: A2AKey }
}
