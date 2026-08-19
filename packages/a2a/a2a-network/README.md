# `@deepseek-ai/dsh-a2a-network`

English | [中文](README.zh.md)

This package supplies the missing public-network runtime for equal-peer DSH Agents. `dsh-a2a-relay` binds one public HTTPS service and keeps outbound WebSocket tunnels from nodes. `dsh-a2a-node` runs on a user's computer, starts a loopback A2A Gateway, opens the outbound tunnel, and optionally registers and heartbeats the peer in the DSH Registry.

The Relay forwards standard Agent Card, A2A task, and direct-upload HTTP requests under `/agents/{agentId}/...`; it never executes Agent code. The node executes only the local Gateway executor configured by its owner. `applyDshNode` supplies an executor that creates a normal DSH Agent, submits the task through `agent.followup()`, preserves image attachments through `ctx.attachments`, and waits for `agent.whenIdle()`. Remote peers cannot read arbitrary node files or install tools and skills.

## Node configuration

The CLI reads `DSH_A2A_AGENT_ID`, `DSH_A2A_RELAY_URL`, `DSH_A2A_RELAY_TOKEN`, `DSH_A2A_REGISTRY_URL`, `DSH_A2A_REGISTRY_TOKEN`, `DSH_A2A_AGENT_NAME`, `DSH_A2A_AGENT_DESCRIPTION`, and `DSH_A2A_SKILLS_JSON`. Registry registration uses the Relay-derived public endpoint, so the node does not need an inbound port or a LAN address.

## Two-peer setup

Run one Relay and one Registry on a public HTTPS host, then run the same DSH composition on both computers. Give each computer a unique `DSH_A2A_AGENT_ID`, the same Relay URL and join token, and the Registry URL plus registration token. Use different model credentials and `DSH_A2A_SKILLS_JSON` values on each computer; B can declare a vision model with `inputModes: ["image/png", "image/jpeg"]`, while A can declare any other skill. Both nodes register through an outbound WebSocket and can therefore call each other through the Registry without LAN routing or inbound firewall rules.

The web Settings page is for discovery and Agent Card inspection. The Home composer remains the task entry point: the standard Agent Loop receives `a2a_discover` and `a2a_call` tools, chooses a peer from its declared skills, uploads local files through a one-use ticket, and reads the remote task result. The remote node creates a normal local DSH Agent, so its provider credentials, filesystem policy, tools, and model stay on that computer.

For a vision request, attach a local image by passing its path in `a2a_call.files` and set the MIME type. The caller verifies byte length and SHA-256 before upload; the receiving Gateway verifies them again, stores the image in its local attachment service, and submits an image block to the local model. A text-only DeepSeek adapter cannot consume that block; configure a vision-capable route through `dsh-llm-pi-ai` or another provider that declares image input.

The standalone `dsh-a2a-node` command is a transport and Gateway reference process and uses the default echo executor. To execute real DSH model work on B, load `@deepseek-ai/dsh-a2a-bundle` in B's full DSH profile and set the node settings there; the bundle mounts `applyDshNode` after the Agent Loop and attachment provider.

Minimum node environment (repeat on A and B with different identity and model values):

```sh
DSH_A2A_AGENT_ID=b-vision
DSH_A2A_RELAY_URL=https://agents.example.com
DSH_A2A_RELAY_TOKEN=<relay-join-token>
DSH_A2A_REGISTRY_URL=https://agents.example.com/registry/
DSH_A2A_REGISTRY_TOKEN=<registry-registration-token>
DSH_A2A_SKILLS_JSON='[{"id":"image-analysis","name":"Image analysis","description":"Analyze an uploaded image","inputModes":["image/png","image/jpeg"],"outputModes":["text/plain"]}]'
```

Keep the Relay join token, Relay access token, Registry registration token, and Registry discovery token separate. Put them in DSH credentials or process environment; never include them in `cordis.yml`, Agent Cards, or Registry responses.

## Cordis composition

Mount the package in a full DSH composition after the Agent Loop, attachment store, and a vision-capable model provider are present. The plugin reads `provider` and `model` when supplied; otherwise it uses `ctx.agentDefaultModel`. Model credentials remain on the node. The standalone CLI remains an echo/reference process; use the Cordis plugin for local model execution.

## Model Experience

### Remote task execution

#### What the model sees

The local model sees the `a2a_discover` and `a2a_call` tool schemas plus the task result returned by the selected peer. Relay URLs, access tokens, upload tickets, and WebSocket frames stay in the transport layer. A remote image is presented to the receiving local model as an image block, while the caller sees the returned text or structured task result.

#### Token effect

Discovery adds a small tool-schema and Agent Card cost to the caller's prompt. File bytes are uploaded out of band and are not inserted into the caller's token context. The receiving node pays the normal prompt and image-token cost for the task it executes; the relay does not duplicate those bytes in a model request.

#### KV Cache effect

The stable A2A tool definitions can remain cached between turns. Per-call Agent Card metadata and task results are dynamic, so they invalidate only the suffix of the receiving prompt after the stable tool and system sections. Relay frames and upload bytes are outside KV-cache accounting.

## Known Limitations and Deferred Work

- The Relay is a bounded single-process transport service. Production deployments still need TLS termination, rate limiting, per-node credentials, and durable operational monitoring.
