# A2A Agent 网络

[English](a2a.md) | 中文

A2A Agent 网络 seam 通过与传输实现无关的 `ctx.a2a` 服务，为 DSH 提供远程对等节点发现、Agent Card 读取、直传票据预约、消息提交和任务查询。Service Definition 是 [dsh-a2a](../../packages/a2a/a2a)；[dsh-a2a-client](../../packages/a2a/a2a-client) 是内置的官方 SDK Provider；[dsh-tool-a2a](../../packages/a2a/tool-a2a) 和 [dsh-client-ui-a2a](../../packages/client/ui-a2a) 消费该服务。[dsh-a2a-gateway](../../packages/a2a/a2a-gateway) 提供可执行的参考对等节点，[dsh-a2a-registry](../../packages/a2a/a2a-registry) 提供可选的租约发现，[dsh-a2a-network](../../packages/a2a/a2a-network) 提供公网 Relay、节点出站隧道、重连策略和可选的 DSH Agent Loop executor。

源码：[`packages/a2a/a2a/src/types.ts`](../../packages/a2a/a2a/src/types.ts) 和 [`packages/a2a/a2a/src/index.ts`](../../packages/a2a/a2a/src/index.ts)

## 文件直传

A2A 消息只携带不透明的 `A2AAttachmentRef` 元数据，绝不携带本地路径或文件字节。工具 Consumer 通过 `ctx.fs` 解析并读取本地文件，记录字节长度和 SHA-256，从选定对等节点预约一次性的 `A2AUploadTicket`，直接上传字节，随后在 `A2A_DIRECT_UPLOAD_EXTENSION` 下提交附件引用。Provider 必须拒绝名称、媒体类型、字节长度或摘要与预约不一致的票据。

该扩展只传输字节。标准 Agent Card、消息、任务 ID、任务状态和返回的 Artifact 仍使用 A2A Protocol 值。没有声明直传端点的对等节点仍可接收纯文本请求。

## 发现与权限

静态对等节点别名和公网 Registry 发现共用同一个客户端 Provider。发现仅返回公开端点数据，不会从对等节点安装代码、tools 或 skills。模型只能通过 `a2a_discover`、`a2a_call` 和 `a2a_task` 工具看到远程能力；这些工具保留普通 DSH 的工具审批和会话日志。Registry 成员资格是短期租约，不是身份、计费、信誉或授权系统。

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
