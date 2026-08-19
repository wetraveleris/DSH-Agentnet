# `@deepseek-ai/dsh-a2a-gateway`

[English](README.md) | 中文

A2A Protocol v1.0 集成路径的参考服务。它使用 `@a2a-js/sdk` 官方 HTTP+JSON handler，提供 Agent Card、简单的回显/检查 executor 和 DSH 直传扩展。

```ts
import { startGateway } from '@deepseek-ai/dsh-a2a-gateway'

const gateway = await startGateway({
  host: '0.0.0.0',
  port: 18090,
  publicUrl: 'http://127.0.0.1:18090',
})
```

上传目录为所有者可访问，票据有过期时间且只能使用一次，字节会按声明长度和 SHA-256 校验。示例 executor 只回显元数据；部署到不受信任环境前必须替换为真实 Agent，并在公网入口前配置认证反向代理。

`dsh-a2a-gateway` 二进制文件可以启动参考服务。部署时设置 `DSH_A2A_AGENT_ID`、`DSH_A2A_PORT`、`DSH_A2A_HOST` 和 `DSH_A2A_PUBLIC_URL`；默认 Agent ID 为 `gateway`，默认监听端口为 `18090`。由于 Agent ID 会写入上传票据，`DSH_A2A_AGENT_ID` 必须与客户端配置的 Agent 别名一致。

## 模型体验

无，因为参考服务执行远程 A2A 任务，但不会组装本地模型请求。

#### KV Cache 影响

无；服务位于本地提示词组装过程之外。

## 已知限制与延后工作

- 内置 executor 只回显任务文本和附件元数据；生产 Agent 逻辑、认证、授权和计费由部署方负责。
- 上传是临时且一次性的；断点续传或持久 Artifact 存储需要其他能力。
