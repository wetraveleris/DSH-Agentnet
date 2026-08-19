# `@deepseek-ai/dsh-a2a-bundle`

English | [中文](README.zh.md)

Optional profile patch for the A2A capability. It mounts the official SDK client provider, model-facing A2A tools, and the Web settings contribution. Configure static endpoints in a later `cordis.patch.yml` layer, or set `DSH_A2A_REGISTRY_URL` and optional `DSH_A2A_REGISTRY_DISCOVERY_TOKEN` for capability discovery.

When `DSH_A2A_AGENT_ID`, `DSH_A2A_RELAY_URL`, `DSH_A2A_RELAY_TOKEN`, and `DSH_A2A_SKILLS_JSON` are set, the same patch also mounts the outbound node. It uses the local DSH Agent Loop through `@deepseek-ai/dsh-a2a-network`; the Homepage remains the task entry point and the node's model credentials stay local.

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
    agents:
      lab:
        endpoint: 'https://agent.example.com'
        uploadUrl: 'https://agent.example.com/dsh/uploads'
```

The bundle is deliberately not inserted into `dsh-base` or `dsh-web-app`; installing it is an explicit capability choice. The Agent network Settings page can persist the node's non-secret `a2a-node` settings and start or stop participation; Relay and Registry secrets remain credential references.

## Model Experience

Indirectly, through the `tool-a2a` row that the patch mounts; the bundle itself contributes no prompt or tool schema.

#### KV Cache effect

No direct effect; the mounted tool owns its static prompt and schema prefix.

## Known Limitations and Deferred Work

- The patch starts without static peers or a Registry URL. Endpoint configuration, authentication, billing, and remote skill policy remain deployment-owned. A node requires the base profile's Agent Loop, attachment provider, and a model route that accepts the declared input modes.
