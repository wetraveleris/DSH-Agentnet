# `@deepseek-ai/dsh-a2a-gateway`

English | [中文](README.zh.md)

Reference server for the A2A Protocol v1.0 integration path. It uses `@a2a-js/sdk`'s official HTTP+JSON handler and serves an Agent Card, a small echo/inspection executor, and DSH's direct-upload extension.

```ts
import { startGateway } from '@deepseek-ai/dsh-a2a-gateway'

const gateway = await startGateway({
  host: '0.0.0.0',
  port: 18090,
  publicUrl: 'http://127.0.0.1:18090',
})
```

The upload root is owner-only, tickets expire, uploads are single-use, and bytes are checked against the declared length and SHA-256. The sample executor only echoes metadata; replace it with a real Agent implementation before exposing the service to untrusted callers. Put an authenticated reverse proxy in front of it for a public deployment.

The `dsh-a2a-gateway` binary starts the reference server. Set `DSH_A2A_AGENT_ID`, `DSH_A2A_PORT`, `DSH_A2A_HOST`, and `DSH_A2A_PUBLIC_URL` for a deployment; the default Agent ID is `gateway` and the default bind port is `18090`. `DSH_A2A_AGENT_ID` must match the configured client alias because it is returned in upload tickets.

## Model Experience

None, as the reference server executes remote A2A tasks but does not assemble a local model request.

#### KV Cache effect

None; the server is outside the local prompt-assembly process.

## Known Limitations and Deferred Work

- The included executor only echoes task text and attachment metadata; production Agent logic, authentication, authorization, and billing are deployment-owned.
- Uploads are temporary and single-use; resumable or durable artifact storage requires another capability.
