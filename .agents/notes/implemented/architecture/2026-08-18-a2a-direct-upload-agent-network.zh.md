# Agent Note: 公网 A2A Agent 网络与文件直传

Status: implemented

[English](2026-08-18-a2a-direct-upload-agent-network.md) | 中文

## 问题

DSH 需要调用本地进程之外的 Agent 所拥有的能力。远程 Agent 可以发布 skills 并执行 A2A 任务，但无法读取调用方的本地文件系统。发送本地路径没有意义，而把任意第三方插件代码复制到调用方会越过 harness 无法自动批准的信任边界。

## 决策

DSH 在 `packages/a2a/` 下提供可选的 A2A 能力组：`@deepseek-ai/dsh-a2a` 负责服务词汇，`@deepseek-ai/dsh-a2a-client` 使用官方 `@a2a-js/sdk@1.0.1` 客户端，`@deepseek-ai/dsh-tool-a2a` 提供发现和任务工具，`@deepseek-ai/dsh-a2a-gateway` 提供用于集成测试和实验的小型参考 Agent。`@deepseek-ai/dsh-a2a-network` 增加公网 Relay 和节点出站隧道，使 NAT 后的平等 Peer 无需入站端口即可发布由 Relay 派生的 Agent Card。其 Cordis 适配器可以把入站工作提交给节点已有的 DSH Agent Loop。`@deepseek-ai/dsh-client-ui-a2a` 只负责 Settings 网络管理和 Agent Card 发现，`@deepseek-ai/dsh-a2a-bundle` 负责保持组合为可选项：首页标准模式仍是唯一的用户任务入口。

客户端发现 `/.well-known/agent-card.json`，通过官方 SDK 选择 Agent Card 声明的 A2A 1.0 HTTP+JSON 或 JSON-RPC 传输，发送标准 Message，并将标准 Message、Task 和 Artifact 投影为 DSH 自有的 JSON 类型。`agent-loop` 保持不变；工具消费方通过正常的能力 seam 调用 `ctx.a2a`。

本地文件使用 URI 为 `https://deepseek.com/a2a/extensions/direct-upload/v1` 的 DSH 扩展。调用方在上限内读取原始字节，把文件名、媒体类型、字节长度和小写 SHA-256 发送给配置的远程上传端点，取得短期一次性票据，把字节直接上传到远程 Agent 的私有临时目录，然后只在 A2A 消息元数据中发送不透明的附件 ID 和完整性元数据。远程 Gateway 在写入 `0700` 目录和 `0600` 内容文件前校验 token、过期时间、长度和摘要；过期记录自动清理。

Provider 默认拒绝未知 Agent ID、非 HTTPS 端点、无效摘要、超大上传、格式错误的票据和失败的 HTTP 响应。`allowInsecureHttp` 仅用于本地开发并且必须显式配置。浏览器 UI 直接使用票据 URL 上传，不会把本地路径暴露给远程 Agent。

平等 Peer 使用出站 WebSocket 隧道：节点携带 join token 打开 `/v1/tunnel`，Relay 把 `/agents/{agentId}/...` 请求转发到隧道，节点只代理到自己的回环 Gateway。隧道断开后使用有界指数延迟重连；Relay 不执行节点代码。DSH executor 会创建本机 Agent，把入站指令和已校验的图片引用作为普通 user message 写入，等待整个 Agent idle，返回文本 Artifact 前释放该 Agent。

## 曾考虑的替代方案

**在 A2A 消息中嵌入本地路径。** 远程机器无法解析调用方路径，路径名还会泄露本地布局，因此消息只携带不透明的远程附件引用。

**OSS 或永久共享的 Artifact 存储。** 中央存储会为这类直连流程增加凭据、保留策略、清理逻辑和第二条数据通道。第一版直接把字节发送给选定的 Agent，并保存在带 TTL 的私有目录中；未来可以增加独立的 Artifact 能力，而无需改变 A2A 消息扩展。

**把远程插件或 skill 下载后在本地执行。** 发布代码不等于授予能力。DSH 不安装或执行远程代码，只调用远程 Agent 声明的任务端点。

**通过 A2A 代理父 Agent 的文件系统或子进程。** 这会让公网 Agent 获得本地执行权限。远程 Agent 接收上传字节和任务元数据，本地 `ctx.fs` 仍是本地读取的唯一所有者。

## 测试

Gateway 和 network 测试使用临时端口上的真实 Express 与 WebSocket listener，覆盖 Agent Card 发现、错误元数据、错误 token、摘要和长度校验、一次性上传票据、A2A 1.0 `message:send`、Completed Task 查询、附件元数据、出站 NAT 风格隧道和重连。TypeScript 检查覆盖 Host 和 Client 聚合工程。手工本地 smoke 也验证了官方 card 和 HTTP+JSON 端点；部署 smoke 与单元测试分开。

## 后果

该能力是可选且由配置驱动的：Profile 所有者必须提供 Agent 端点和可选的上传端点。默认 bundle 使用空 Agent 映射，不会发起远程调用。直传受客户端和 Gateway 限制，并且不是持久 Artifact；需要长期保存或超大数据的调用需要未来的 Artifact 能力。

参考 Gateway 只为测试回显任务文本和附件元数据；DSH executor 是可选项，要求本机挂载 Agent Loop、附件 Provider 和支持视觉的模型。两者都不是市场、支付服务、插件注册表或生产多租户 Gateway。认证、计费、信誉、流式订阅、取消策略和远程 skill 执行仍由部署方负责。该设计保留 DSH 的本地文件系统和插件信任边界，同时允许远程 Agent 提供与模型无关的能力。
