# `@deepseek-ai/dsh-a2a-network`

[English](README.md) | 中文

该包提供平等 Peer DSH Agent 所需的公网运行时。`dsh-a2a-relay` 绑定一个公网 HTTPS 服务，并维护节点主动建立的出站 WebSocket 隧道。`dsh-a2a-node` 运行在用户电脑上，启动本机回环 A2A Gateway，建立出站隧道，并可选地向 DSH Registry 注册和发送心跳。

Relay 会将标准 Agent Card、A2A 任务和直传请求转发到 `/agents/{agentId}/...`，但不会执行 Agent 代码。节点只执行所有者配置的本地 Gateway executor。`applyDshNode` 提供一个 executor，它通过 `agent.followup()` 创建并提交普通 DSH Agent 任务，通过 `ctx.attachments` 保留图片附件，并等待 `agent.whenIdle()`。远程 Peer 不能读取节点任意文件，也不能安装 tools 或 skills。

## 节点配置

CLI 读取 `DSH_A2A_AGENT_ID`、`DSH_A2A_RELAY_URL`、`DSH_A2A_RELAY_TOKEN`、`DSH_A2A_REGISTRY_URL`、`DSH_A2A_REGISTRY_TOKEN`、`DSH_A2A_AGENT_NAME`、`DSH_A2A_AGENT_DESCRIPTION` 和 `DSH_A2A_SKILLS_JSON`。Registry 注册使用 Relay 派生的公网 Endpoint，因此节点不需要入站端口或局域网地址。

## 双节点配置

在公网 HTTPS 主机上运行一个 Relay 和一个 Registry，然后在两台电脑上运行相同的 DSH 组合。每台电脑使用唯一的 `DSH_A2A_AGENT_ID`，共享 Relay URL 和加入 Token，并配置 Registry URL 与注册 Token。两台电脑可以使用不同的模型凭据和 `DSH_A2A_SKILLS_JSON`；例如 B 声明接收 `image/png`、`image/jpeg` 的视觉模型，A 声明其他能力。两个节点都通过出站 WebSocket 注册，因此互相调用不需要局域网路由或开放入站端口。

Web Settings 页面只负责发现节点和查看 Agent Card。真正发送任务仍使用首页输入框：标准 Agent Loop 获得 `a2a_discover`、`a2a_call` 工具后，根据 Skill 选择节点，通过一次性票据上传本地文件，再读取远端任务结果。远端节点会创建一个普通的本地 DSH Agent，因此它的模型凭据、文件系统策略、工具和模型都留在远端电脑。

视觉请求在 `a2a_call.files` 中传入本地图片路径并声明 MIME 类型。调用方先校验字节长度和 SHA-256，接收方 Gateway 再次校验，把图片保存到本机 attachment 服务，并将 image block 提交给本地模型。纯文本 DeepSeek Adapter 不能消费该 block；B 必须通过 `dsh-llm-pi-ai` 或其他声明支持图片输入的 Provider 配置视觉路由。

独立运行的 `dsh-a2a-node` 命令是传输和 Gateway 参考进程，默认使用 echo executor。要让 B 执行真正的 DSH 模型任务，应在 B 的完整 DSH Profile 中加载 `@deepseek-ai/dsh-a2a-bundle` 并配置节点设置；该 Bundle 会在 Agent Loop 和 attachment provider 之后挂载 `applyDshNode`。

两台电脑都需要以下最小环境变量，只替换节点身份和模型配置：

```sh
DSH_A2A_AGENT_ID=b-vision
DSH_A2A_RELAY_URL=https://agents.example.com
DSH_A2A_RELAY_TOKEN=<relay-join-token>
DSH_A2A_REGISTRY_URL=https://agents.example.com/registry/
DSH_A2A_REGISTRY_TOKEN=<registry-registration-token>
DSH_A2A_SKILLS_JSON='[{"id":"image-analysis","name":"Image analysis","description":"Analyze an uploaded image","inputModes":["image/png","image/jpeg"],"outputModes":["text/plain"]}]'
```

Relay 加入 Token、Relay 访问 Token、Registry 注册 Token 和 Registry 发现 Token 必须分开保存。请将它们放入 DSH credentials 或进程环境，不要写入 `cordis.yml`、Agent Card 或 Registry 响应。

## Cordis 组合

在 Agent Loop、附件存储和支持视觉的模型 Provider 都已加载后，将本包挂载到完整 DSH 组合中。显式提供 `provider` 和 `model` 时插件使用它们，否则读取 `ctx.agentDefaultModel`。模型凭据只保留在节点本机。独立 CLI 仍是 echo/参考进程；本地模型执行应使用 Cordis 插件。

## 模型体验

### 远程任务执行

#### 模型看到什么

本地模型会看到 `a2a_discover`、`a2a_call` 工具 Schema，以及被选中 Peer 返回的任务结果。Relay URL、访问 Token、上传票据和 WebSocket 帧都留在传输层，不会进入模型上下文。远程图片会作为图片块交给接收节点上的本地模型，调用方看到的是返回的文本或结构化任务结果。

#### Token 影响

发现流程会为调用方提示词增加少量工具 Schema 和 Agent Card Token。文件字节通过带外通道上传，不会插入调用方的 Token 上下文。接收节点为自己执行的任务承担正常的提示词和图片 Token 成本；Relay 不会把这些字节重复放入模型请求。

#### KV Cache 影响

稳定的 A2A 工具定义可以在多轮之间复用缓存。每次调用的 Agent Card 元数据和任务结果是动态内容，因此只会使接收方提示词中稳定系统段和工具段之后的后缀失效。Relay 帧和上传字节不参与 KV Cache 计费。

## 已知限制与延后工作

- Relay 是有边界的单进程传输服务。正式部署仍需 TLS 终止、限流、每节点凭据和持久化运维监控。
