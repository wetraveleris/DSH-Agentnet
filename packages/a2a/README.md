# a2a/ — Agent-to-Agent interoperability

English | [中文](README.zh.md)

The A2A group connects DSH to remote Agents through the standard A2A Protocol v1.0 and one DSH direct-upload extension. The service definition, official SDK client, model-facing tools, and reference Gateway remain separate so deployments can select only the roles they need.

| Package | Role | ctx key |
|---|---|---|
| [`a2a/`](a2a/README.md) | Service Definition and shared A2A types | `ctx.a2a` |
| [`a2a-client/`](a2a-client/README.md) | Official SDK client Provider | registers `ctx.a2a` |
| [`tool-a2a/`](tool-a2a/README.md) | Model-facing discovery and task Consumer | consumes `ctx.a2a` |
| [`a2a-gateway/`](a2a-gateway/README.md) | Reference Agent Card, task, and direct-upload server | HTTP endpoint |
| [`a2a-registry/`](a2a-registry/README.md) | Equal-peer lease and skill discovery service | HTTP endpoint |
| [`a2a-network/`](a2a-network/README.md) | Public Relay, outbound node tunnel, and optional DSH Loop executor | `dsh-a2a-relay`, `dsh-a2a-node` |

The browser settings Consumer lives in [`client/ui-a2a/`](../client/ui-a2a/README.md), and its opt-in profile patch lives in [`bundle/a2a-bundle/`](../bundle/a2a-bundle/README.md). Remote code is never installed automatically; local files are uploaded as bytes to a short-lived remote ticket.

## Model Experience

None, as this group README only indexes packages; each package owns its model-facing contract.

#### KV Cache effect

None; this index does not participate in prompt assembly.

## Known Limitations and Deferred Work

- The group index does not define authentication, billing, marketplace, or remote skill execution policy; those belong to the provider, deployment, and consuming profile.
