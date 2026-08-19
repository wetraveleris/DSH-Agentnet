# `@deepseek-ai/dsh-a2a-registry`

[English](README.md) | 中文

用于发现平等 Peer DSH Agent 的小型部署服务。Peer 注册 Agent Card URL、A2A Endpoint、上传 Endpoint 和声明的 Skill ID。心跳会续租；过期 Peer 会自动从发现结果中消失，Registry 不执行任务。

Registry 不运行 Agent 任务，也不会安装远程代码。调用方使用返回记录读取 Agent Card，再通过现有 A2A Client 调用 Peer。注册数据可写入原子替换的 JSON 文件，适合单实例实验；生产环境应替换为共享数据库。

## HTTP API

```text
POST   /v1/agents/register              Bearer registration token
POST   /v1/agents/:id/heartbeat         Bearer registration token
DELETE /v1/agents/:id                   Bearer registration token
GET    /v1/agents?skill=image-analysis  public or discovery token
GET    /v1/agents/:id                   public or discovery token
GET    /healthz
```

运行二进制时设置 `DSH_A2A_REGISTRY_TOKEN`（至少 16 个字符）、`DSH_A2A_REGISTRY_HOST`、`DSH_A2A_REGISTRY_PORT`、`DSH_A2A_REGISTRY_PUBLIC_URL` 和 `DSH_A2A_REGISTRY_DATA`。私有发现还需设置 `DSH_A2A_REGISTRY_DISCOVERY_TOKEN`。注册 Token 与发现 Token 必须不同，因为 Client 只需要发现权限。正式公网部署前，应在 HTTP 进程前增加 TLS、限流和部署方身份认证。

## 模型体验

无，因为这是部署服务。模型可见的 `tool-a2a` 通过 `A2AClientService` 搜索 Registry，再通过同一个 A2A Client 调用发现的 Peer。

#### KV Cache 影响

无；Registry 响应不参与模型提示词组装。

## 已知限制与延后工作

- 第一版是单进程 JSON 文件存储，不支持多实例共享。
- 注册 Token 是部署凭据，不是按用户计费或信誉身份。
