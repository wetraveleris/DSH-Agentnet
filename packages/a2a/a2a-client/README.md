# `@deepseek-ai/dsh-a2a-client`

English | [中文](README.zh.md)

This provider implements `ctx.a2a` with the official `@a2a-js/sdk@1.0.1` client. It discovers `/.well-known/agent-card.json`, negotiates the Agent Card's JSON-RPC or HTTP+JSON interface, sends standard A2A messages, and reads standard Tasks.

## Direct upload

An Agent configured with `uploadUrl` must implement DSH's `POST` reservation and single-use `PUT` ticket contract. The client sends file name, media type, byte length, and SHA-256 to reserve a destination, verifies the ticket, and verifies bytes again before upload. The returned attachment id is referenced in the A2A message metadata under `A2A_DIRECT_UPLOAD_EXTENSION`.

The provider rejects unknown Agents, non-HTTPS endpoints by default, invalid SHA-256 values, oversized uploads, mismatched byte lengths, and failed HTTP responses. `allowInsecureHttp` is an explicit local-development opt-in.

## Configuration

```yaml
- id: a2a-client
  name: '@deepseek-ai/dsh-a2a-client'
  config:
    agents:
      research:
        endpoint: 'https://agent.example.com'
        uploadUrl: 'https://agent.example.com/dsh/uploads'
    registryUrl: 'https://registry.example.com/a2a-registry/'
    registryToken: !!js process.env.DSH_A2A_REGISTRY_DISCOVERY_TOKEN
    relayAccessToken: !!js process.env.DSH_A2A_RELAY_ACCESS_TOKEN
    maxUploadBytes: 10485760
```

Headers are supported for a trusted private deployment but should contain references resolved by the credentials capability rather than plaintext secrets in a profile. `relayAccessToken` applies a shared Bearer header to Registry-discovered peers published through one private Relay; it is not returned by Registry responses.

When `registryUrl` is configured, `searchAgents(skill)` calls `GET /v1/agents` and caches the returned endpoint and upload URL for later `discover`, `send`, and upload calls. `registryToken` is a discovery credential; it is separate from the Registry registration token used by peers for registration and heartbeats. A Registry URL and discovered peer URLs must use HTTPS unless `allowInsecureHttp` is enabled for local development. A URL with a path prefix is preserved, so `https://host/a2a-registry/` maps to `https://host/a2a-registry/v1/agents`.

## Model Experience

Indirectly, through `@deepseek-ai/dsh-tool-a2a`, which owns the model-facing discovery, upload, and task schemas over `ctx.a2a`.

#### KV Cache effect

No direct effect; the provider changes remote task results, while the tool consumer owns any prompt and result text.

## Known Limitations and Deferred Work

- The provider does not persist remote task state locally or install remote skills; it returns standard Task projections and leaves continuation to the caller.
- Direct upload is bounded by `maxUploadBytes` and requires a separate configured upload endpoint.
