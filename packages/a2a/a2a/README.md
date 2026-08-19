# `@deepseek-ai/dsh-a2a`

English | [中文](README.zh.md)

Service definition for remote Agent discovery, direct-upload reservation, standard A2A messages, and task reads. Providers implement `ctx.a2a`; model tools and Web UI consume that service instead of importing a transport.

`A2A_DIRECT_UPLOAD_EXTENSION` identifies DSH's optional file-transfer extension. Agent Card discovery, messages, task ids, states, and artifacts remain standard A2A Protocol v1.0 values. The extension transfers bytes directly to the remote Agent and contributes only opaque attachment metadata to the following A2A message.

## Model Experience

None, as this package registers no tools or prompt text.

#### KV Cache effect

None; the service definition does not participate in prompt assembly.

## Known Limitations and Deferred Work

- The first extension version supports one complete upload per ticket. Resumable transfer, payment settlement, and patch application are outside this service definition.
