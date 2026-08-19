# A2A Agent Network

English | [中文](a2a.zh.md)

The A2A agent-network seam gives DSH a transport-neutral `ctx.a2a` service for remote peer discovery, Agent Card reads, direct-upload ticket reservation, message submission, and task reads. The Service Definition is [dsh-a2a](../../packages/a2a/a2a); [dsh-a2a-client](../../packages/a2a/a2a-client) is the shipped official-SDK provider, while [dsh-tool-a2a](../../packages/a2a/tool-a2a) and [dsh-client-ui-a2a](../../packages/client/ui-a2a) consume the service. [dsh-a2a-gateway](../../packages/a2a/a2a-gateway) supplies an executable peer endpoint, [dsh-a2a-registry](../../packages/a2a/a2a-registry) provides optional lease-based discovery, and [dsh-a2a-network](../../packages/a2a/a2a-network) supplies the public Relay, outbound node tunnel, reconnect policy, and optional DSH Agent Loop executor.

Source: [`packages/a2a/a2a/src/types.ts`](../../packages/a2a/a2a/src/types.ts) and [`packages/a2a/a2a/src/index.ts`](../../packages/a2a/a2a/src/index.ts)

## Direct upload

An A2A message carries opaque `A2AAttachmentRef` metadata, never a local path or file bytes. The tool consumer resolves and reads a local file through `ctx.fs`, records its byte length and SHA-256, reserves a one-use `A2AUploadTicket` from the selected peer, uploads the bytes directly, then submits the attachment reference under `A2A_DIRECT_UPLOAD_EXTENSION`. A provider must reject a ticket whose name, media type, byte length, or digest does not match the reservation.

The extension only moves bytes. Standard Agent Cards, messages, task ids, task states, and returned artifacts remain A2A Protocol values. A peer that does not advertise a direct-upload endpoint can still receive text-only requests.

## Discovery and authority

Static peer aliases and public Registry discoveries share the same client provider. Discovery returns public endpoint data and does not install code, tools, or skills from a peer. The model sees remote capabilities only through the `a2a_discover`, `a2a_call`, and `a2a_task` tools, which preserve ordinary DSH tool approval and session logging. Registry membership is a short-lived lease and is not an identity, payment, reputation, or authorization system.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxa2a--a2aservice"></a>

### `ctx.a2a` — `A2AService`

Service implemented by one configured A2A client provider.

```ts cordis-catalog
/**
 * Return configured Agents without secret transport headers.
 * @returns configured Agents without secret headers.
 */
listAgents(): readonly A2AAgentView[]

/**
 * Search the public Registry for peers advertising a skill.
 * @param skill - optional declared skill filter.
 * @param signal - cancels Registry discovery.
 * @returns discovered peers.
 */
searchAgents(skill?: string, signal?: AbortSignal): Promise<readonly A2AAgentView[]>

/**
 * Return the provider's direct-upload byte limit.
 * @returns maximum number of raw bytes accepted by direct upload.
 */
maxUploadBytes(): number

/**
 * Fetch and project one peer's standard Agent Card.
 * @param agentId - configured Agent to inspect.
 * @param signal - cancels discovery.
 * @returns projected Agent Card.
 */
discover(agentId: A2AAgentId, signal?: AbortSignal): Promise<A2AAgentCardView>

/**
 * Reserve a short-lived direct-upload destination on a peer.
 * @param request - file metadata to reserve remotely.
 * @param signal - cancels allocation.
 * @returns short-lived upload destination.
 */
prepareUpload(request: A2APrepareUploadRequest, signal?: AbortSignal): Promise<A2AUploadTicket>

/**
 * Upload bytes to a previously reserved one-use destination.
 * @param ticket - remote one-use destination.
 * @param bytes - bytes whose digest and length must match the ticket.
 * @param signal - cancels upload.
 * @returns a promise that resolves after the upload succeeds.
 */
upload(ticket: A2AUploadTicket, bytes: Uint8Array, signal?: AbortSignal): Promise<void>

/**
 * Send a standard A2A message to a peer.
 * @param request - message and optional remote attachment handles.
 * @param signal - cancels the A2A call.
 * @returns message or task snapshot.
 */
send(request: A2ASendRequest, signal?: AbortSignal): Promise<A2ATaskView>

/**
 * Read the latest state of a remote A2A task.
 * @param request - remote task identity.
 * @param signal - cancels the A2A call.
 * @returns latest task snapshot.
 */
getTask(request: A2AGetTaskRequest, signal?: AbortSignal): Promise<A2ATaskView>
```

Source: [`packages/a2a/a2a/src/index.ts:21`](../../packages/a2a/a2a/src/index.ts)
<!-- END GENERATED cordis-surface -->
