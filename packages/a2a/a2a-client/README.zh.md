# `@deepseek-ai/dsh-a2a-client`

[English](README.md) | 中文

本 Provider 使用官方 `@a2a-js/sdk@1.0.1` 实现 `ctx.a2a`。它读取 `/.well-known/agent-card.json`，根据 Agent Card 协商 JSON-RPC 或 HTTP+JSON，发送标准 A2A 消息并查询标准 Task。

## 直传

配置 `uploadUrl` 的 Agent 必须实现 DSH 的 `POST` 预约和一次性 `PUT` 票据接口。客户端发送文件名、媒体类型、字节长度和 SHA-256 预约目的地；上传前再次校验票据和字节摘要。返回的附件 ID 通过 `A2A_DIRECT_UPLOAD_EXTENSION` 放入 A2A 消息元数据。

Provider 会拒绝未知 Agent、默认非 HTTPS 地址、非法 SHA-256、超大文件、长度不一致和失败的 HTTP 响应。`allowInsecureHttp` 只能作为本地开发的显式开关。

## 配置

```yaml
- id: a2a-client
  name: '@deepseek-ai/dsh-a2a-client'
  config:
    agents:
      research:
        endpoint: 'https://relay.example.com/agents/research'
        cardUrl: 'https://relay.example.com/agents/research/.well-known/agent-card.json'
        uploadUrl: 'https://relay.example.com/agents/research/dsh/uploads'
    registryUrl: 'https://registry.example.com/a2a-registry/'
    registryToken: !!js process.env.DSH_A2A_REGISTRY_DISCOVERY_TOKEN
    registryTokenRef: DSH_A2A_REGISTRY_DISCOVERY_TOKEN
    relayAccessToken: !!js process.env.DSH_A2A_RELAY_ACCESS_TOKEN
    relayAccessTokenRef: DSH_A2A_RELAY_ACCESS_TOKEN
    maxUploadBytes: 10485760
```

私有部署可以配置请求头，但应通过 credentials capability 引用凭据，而不是把明文密钥放入 profile。`relayAccessToken` 会为通过 Registry 发现、且发布在同一私有 Relay 上的 Peer 应用共享 Bearer 请求头；Registry 响应不会返回该密钥。

`registryTokenRef` 和 `relayAccessTokenRef` 让 Settings section 在每次操作时通过 `ctx.credentials` 解析 Token。部署配置中的明文 Token 优先；Settings 页面只保存引用，因此凭据轮换无需重启客户端即可生效。

配置 `registryUrl` 后，`searchAgents(skill)` 会调用 `GET /v1/agents`，并缓存每个 Peer 返回的 Card、任务与上传 URL，供后续 `discover`、`send` 和上传操作使用。客户端读取 Registry 明确返回的 `cardUrl`；静态 Agent 未配置 `cardUrl` 时，会在完整 Endpoint 路径下派生 `/.well-known/agent-card.json`。`registryToken` 是发现凭据，与 Peer 注册和心跳使用的 Registry 注册 Token 分离。Registry URL 与发现到的 Peer URL 默认必须使用 HTTPS；只有本地开发才应启用 `allowInsecureHttp`。所有 URL 的路径前缀都会保留。

## 模型体验

间接影响模型：`@deepseek-ai/dsh-tool-a2a` 通过 `ctx.a2a` 负责发现、上传和任务的模型可见 schema。

#### KV Cache 影响

无直接影响；Provider 改变远程任务结果，工具消费方负责提示词和结果文本。

## 已知限制与延后工作

- Provider 不会在本地持久化远程任务状态，也不会安装远程 skill；它只返回标准 Task 投影，后续操作由调用方负责。
- 直传受 `maxUploadBytes` 限制，并且必须配置独立的上传端点。
