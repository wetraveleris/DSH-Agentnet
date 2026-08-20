# `@deepseek-ai/dsh-a2a-bundle`

[English](README.md) | 中文

A2A capability 的可选 Profile patch。它挂载官方 SDK Client Provider、模型 A2A 工具和 Web Settings 贡献。静态 Endpoint 可在后续 `cordis.patch.yml` 层配置；能力发现可通过 `DSH_A2A_REGISTRY_URL` 和可选的 `DSH_A2A_REGISTRY_DISCOVERY_TOKEN` 启用。

设置 `DSH_A2A_AGENT_ID`、`DSH_A2A_RELAY_URL`、`DSH_A2A_RELAY_TOKEN` 和 `DSH_A2A_SKILLS_JSON` 后，同一 patch 还会挂载节点出站隧道。它通过 `@deepseek-ai/dsh-a2a-network` 使用本机 DSH Agent Loop；首页仍是任务入口，节点模型凭据只保留在本机。

```yaml
dsh:
  profile:
    bundles:
      - '@deepseek-ai/dsh-base'
      - '@deepseek-ai/dsh-a2a-bundle'

- id: a2a-client
  config:
    registryUrl: 'https://registry.example.com/a2a-registry/'
    registryToken: !!js process.env.DSH_A2A_REGISTRY_DISCOVERY_TOKEN
    registryTokenRef: DSH_A2A_REGISTRY_DISCOVERY_TOKEN
    relayAccessTokenRef: DSH_A2A_RELAY_ACCESS_TOKEN
    agents:
      lab:
        endpoint: 'https://agent.example.com'
        uploadUrl: 'https://agent.example.com/dsh/uploads'
```

该 Bundle 不会自动插入 `dsh-base` 或 `dsh-web-app`；安装它本身就是一次显式 capability 选择。Agent 网络 Settings 页面可以保存节点的非敏感 `a2a-node` 设置并启动或停止参与网络；Relay 和 Registry 密钥仍使用 credential 引用。

## 模型体验

间接影响模型：patch 挂载的 `tool-a2a` 行负责提示词和工具 schema；Bundle 本身不贡献它们。

#### KV Cache 影响

无直接影响；挂载的工具负责静态提示词和 schema 前缀。

## 已知限制与延后工作

- Patch 初始不含静态 Peer 或 Registry URL。端点配置、认证、计费和远程 Skill 策略由部署方负责。节点要求基础 Profile 已加载 Agent Loop、附件 Provider，并且模型路由接受声明的输入模式。
