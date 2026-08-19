/** A2A capability definition shared by providers and consumers. @module @deepseek-ai/dsh-a2a */

import type { Context } from '@deepseek-ai/cordis'
import type {
  A2AAgentCardView,
  A2AAgentId,
  A2AAgentView,
  A2AGetTaskRequest,
  A2APrepareUploadRequest,
  A2ASendRequest,
  A2ATaskView,
  A2AUploadTicket,
} from './types.ts'

export type * from './types.ts'

/** URI identifying DSH's optional direct-upload extension to A2A. */
export const A2A_DIRECT_UPLOAD_EXTENSION = 'https://deepseek.com/a2a/extensions/direct-upload/v1'

/** Service implemented by one configured A2A client provider. */
export interface A2AService {
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
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    a2a: A2AService
  }
}

/** Type-only package: providers register `ctx.a2a`. */
export function apply(_ctx: Context): void {}
