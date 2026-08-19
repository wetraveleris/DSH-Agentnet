# a2a/ — Agent-to-Agent 互操作

[English](README.md) | 中文

A2A 组通过标准 A2A Protocol v1.0 和一个 DSH 文件直传扩展，把 DSH 连接到远程 Agent。服务定义、官方 SDK 客户端、面向模型的工具和参考 Gateway 保持分离，因此部署可以只选择需要的角色。

| 包 | 角色 | ctx key |
|---|---|---|
| [`a2a/`](a2a/README.md) | 服务定义和共享 A2A 类型 | `ctx.a2a` |
| [`a2a-client/`](a2a-client/README.md) | 官方 SDK 客户端 Provider | 注册 `ctx.a2a` |
| [`tool-a2a/`](tool-a2a/README.md) | 面向模型的发现和任务 Consumer | 消费 `ctx.a2a` |
| [`a2a-gateway/`](a2a-gateway/README.md) | Agent Card、任务和文件直传参考服务 | HTTP 端点 |
| [`a2a-registry/`](a2a-registry/README.md) | 平等 Peer 租约和 Skill 发现服务 | HTTP 端点 |
| [`a2a-network/`](a2a-network/README.md) | 公网 Relay、节点出站隧道和可选 DSH Loop executor | `dsh-a2a-relay`、`dsh-a2a-node` |

浏览器 Settings Consumer 位于 [`client/ui-a2a/`](../client/ui-a2a/README.md)，可选的 Profile patch 位于 [`bundle/a2a-bundle/`](../bundle/a2a-bundle/README.md)。远程代码不会自动安装；本地文件以字节形式上传到短期远程票据。

## 模型体验

无，因为本组 README 只索引包；每个包负责自己的模型可见约定。

#### KV Cache 影响

无；本索引不参与提示词组装。

## 已知限制与延后工作

- 组索引不定义认证、计费、市场或远程 skill 执行策略；这些属于 Provider、部署方和消费方 Profile。
