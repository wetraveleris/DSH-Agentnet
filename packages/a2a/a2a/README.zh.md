# `@deepseek-ai/dsh-a2a`

[English](README.md) | 中文

A2A 远程 Agent 发现、直传预约、标准消息及任务查询的服务定义。Provider 实现 `ctx.a2a`；模型工具和 Web UI 消费该服务，不直接导入传输实现。

`A2A_DIRECT_UPLOAD_EXTENSION` 标识 DSH 的可选文件直传扩展。Agent Card 发现、消息、任务 ID、状态和 Artifact 仍使用 A2A Protocol v1.0 标准值。扩展把字节直接发送到远程 Agent，随后只在 A2A 消息中贡献不透明的附件元数据。

## 模型体验

无，因为本包不注册工具或提示词。

#### KV Cache 影响

无；服务定义不参与提示词组装。

## 已知限制与延后工作

- 首个扩展版本每个票据只支持一次完整上传。断点续传、支付结算和 Patch 应用不属于本服务定义。
