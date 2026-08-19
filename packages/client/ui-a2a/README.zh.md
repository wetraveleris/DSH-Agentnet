# `@deepseek-ai/dsh-client-ui-a2a`

[English](README.md) | 中文

可选 A2A capability 的浏览器 Settings 贡献。它挂载生成的 A2A Remote，列出 Host Profile 配置的 Agent，并读取 Agent Card 展示标准 Skills 与传输能力。

Settings 只负责网络管理和能力发现，不提交任务，也不上传文件。任务仍从首页会话输入框开始；标准模式通过 Host 暴露 `a2a_discover`、`a2a_call` 和 `a2a_task`，由正常的 agent loop 在需要时选择已加入网络的 Agent。

Host 仍然拥有 Endpoint 配置、凭据、直传传输和 A2A SDK。浏览器不会收到配置的认证请求头。

## 模型体验

无，因为本包只贡献 Settings 展示。模型可见行为由 `@deepseek-ai/dsh-tool-a2a` 负责。

#### KV Cache 影响

无；浏览器状态不属于模型请求前缀。

## 已知限制与延后工作

- UI 不编辑 Agent 端点配置，也不保存凭据；这些仍由 Host/Profile 设置负责。
- Agent Card 通过“读取 Agent Card”按钮显式刷新；流式状态和 Artifact 浏览仍属于模型工具或部署方能力。
