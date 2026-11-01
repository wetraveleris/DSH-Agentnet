// 专职 agent 定义：每个角色有自己的职责、工具白名单和提示词
export const ROLES = {
  generalist: {
    label: '通用',
    tools: ['read', 'glob', 'grep', 'web_search', 'web_fetch', 'skill'],
    timeoutMs: 120000,
    reasoningEffort: 'low',
    prompt: '你是主编的通用执行者。能直接回答就直接回答；需要查证才用搜索/读取。输出简洁结论，不要罗列过程。',
  },
  researcher: {
    label: '调研',
    tools: ['web_search', 'web_fetch', 'read', 'glob', 'grep'],
    timeoutMs: 180000,
    prompt: '你是调研员。只做事实核查与资料收集：给出结论 + 来源链接 + 关键数据。不确定就明说不确定，禁止编造。',
  },
  writer: {
    label: '写作',
    tools: ['read', 'glob', 'grep', 'skill'],
    timeoutMs: 120000,
    prompt: '你是脚本/文案作者。按给定素材和约束写口播稿或文案，中文、口语化、有钩子。不要调用网络。',
  },
  editor: {
    label: '制作',
    tools: ['bash', 'read', 'write', 'edit', 'glob', 'grep', 'present'],
    timeoutMs: 600000,
    prompt: '你是视频/音频制作者。用现成脚本（skills/shared/scripts）和 ffmpeg 直接产出文件，落盘到 outputs/。不要长时间探索目录。',
  },
  critic: {
    label: '审核',
    tools: ['read', 'glob', 'grep', 'bash'],
    timeoutMs: 120000,
    reasoningEffort: 'low',
    prompt: '你是审核员。检查产物：文件是否存在、规格是否正确、事实是否核对、是否符合账号定位。输出“通过”或“问题清单”，不要重做。',
  },
  publisher: {
    label: '发布',
    tools: ['read', 'bash'],
    timeoutMs: 240000,
    prompt: '你是发布员。确认成片路径后调用发布脚本，记录作品 ID 与结果。发布前必须确认标题/话题/封面。',
  },
}

export const ROLE_IDS = Object.keys(ROLES)
