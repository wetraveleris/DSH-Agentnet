# Agent Note: Public A2A Agent network with direct file upload

Status: implemented

English | [中文](2026-08-18-a2a-direct-upload-agent-network.zh.md)

## Problem

DSH needs to call capabilities owned by Agents outside the local process. A remote Agent can advertise skills and execute an A2A task, but it cannot read a caller's local filesystem. Sending local paths is meaningless and copying arbitrary third-party plugin code into the caller would cross a trust boundary that the harness cannot approve automatically.

## Decision

DSH ships an opt-in A2A capability group under `packages/a2a/`: `@deepseek-ai/dsh-a2a` owns the service vocabulary, `@deepseek-ai/dsh-a2a-client` provides the official `@a2a-js/sdk@1.0.1` client, `@deepseek-ai/dsh-tool-a2a` exposes discovery and task tools, and `@deepseek-ai/dsh-a2a-gateway` is a small reference Agent for integration tests and experiments. `@deepseek-ai/dsh-a2a-network` adds a public Relay and an outbound node tunnel, so equal peers behind NAT can publish a Relay-derived Agent Card without inbound ports. Its Cordis adapter can submit inbound work through the node's existing DSH Agent Loop. `@deepseek-ai/dsh-client-ui-a2a` contributes Settings-only network management and Agent Card discovery, while `@deepseek-ai/dsh-a2a-bundle` keeps the composition opt-in. Homepage Standard mode remains the only user task entry point.

The client discovers `/.well-known/agent-card.json`, selects the advertised A2A 1.0 HTTP+JSON or JSON-RPC transport through the official SDK, sends standard Messages, and projects standard Messages, Tasks, and Artifacts into DSH-owned JSON types. The `agent-loop` remains unchanged; the tool consumer calls `ctx.a2a` through the normal capability seam.

The client provider registers the `a2a-client` settings namespace when the settings capability is present. Registry discovery and Relay access tokens can be configured as credential references; the provider resolves those references at each operation, while a literal composition token remains an explicit deployment override. The Settings UI writes only references, so joining a network also configures the Homepage tools without persisting secret values.

Local files use a DSH extension identified by `https://deepseek.com/a2a/extensions/direct-upload/v1`. The caller reads bounded raw bytes, sends file name, media type, byte length, and lowercase SHA-256 to a configured remote upload endpoint, receives a short-lived single-use ticket, uploads bytes directly to the remote Agent's private temporary directory, and sends only the opaque attachment id plus integrity metadata in A2A message metadata. The remote gateway verifies the token, expiry, length, and digest before writing the bytes to a `0700` directory with a `0600` content file; expired records are removed automatically.

The provider rejects unknown Agent ids, non-HTTPS endpoints by default, invalid digests, oversized uploads, malformed tickets, and failed HTTP responses. `allowInsecureHttp` is an explicit local-development setting. Browser UI uploads use the ticket URL directly and never expose local paths to the remote Agent.

Equal peers use an outbound WebSocket tunnel: the node opens `/v1/tunnel` with a join token, the Relay forwards `/agents/{agentId}/...` requests to that tunnel, and the node proxies only to its loopback Gateway. Tunnel reconnect uses bounded exponential delay; a Relay never executes node code. The DSH-backed node executor creates a fresh local Agent, appends the inbound instruction and validated image references as a normal user message, waits for whole-agent idle, and disposes that Agent before returning the text artifact.

## Alternatives considered

**Embedding local paths in A2A messages.** A remote machine cannot resolve a caller's path, and path names leak local layout. The message carries an opaque remote attachment reference instead.

**OSS or a permanent shared artifact store.** A central store adds credentials, retention, cleanup, and a second data plane for this direct-call workflow. The first implementation sends bytes directly to the selected Agent and keeps them in a private TTL directory; a deployment may add a separate artifact provider later without changing the A2A message extension.

**Downloading and executing remote plugins or skills locally.** Code publication is not capability authorization. DSH does not install or execute remote code; only the remote Agent's declared task endpoint is called.

**Proxying the parent's filesystem or subprocesses over A2A.** That would make a public Agent a privileged local executor. The remote Agent receives uploaded bytes and task metadata, while local `ctx.fs` remains the only owner of local reads.

## Testing

The Gateway and network suites use real Express and WebSocket listeners on ephemeral ports and cover Agent Card discovery, malformed metadata, wrong-token rejection, digest and length enforcement, one-use upload tickets, A2A 1.0 `message:send`, completed Task lookup, attachment metadata, outbound NAT-style tunneling, and reconnect. TypeScript checks cover the Host and Client aggregates. A manual local smoke also exercised the official card and HTTP+JSON endpoints; deployment smoke is intentionally separate from unit tests.

## Consequences

The capability is opt-in and configuration-driven: an Agent endpoint and optional upload endpoint must be supplied by the profile owner. The default bundle has an empty Agent map and no remote calls. Direct uploads are bounded by the client and gateway limits and are not durable artifacts; callers that need long-lived or very large data require a future artifact capability.

The reference Gateway echoes task text and attachment metadata for tests; the DSH-backed executor is opt-in and requires a locally mounted Agent Loop, attachment provider, and vision-capable model. Neither is a marketplace, payment service, plugin registry, or production multi-tenant gateway. Authentication, billing, reputation, streaming subscriptions, cancellation policy, and remote skill execution remain deployment responsibilities. The design preserves DSH's local filesystem and plugin trust boundaries while allowing remote Agents to contribute model-independent capabilities.
