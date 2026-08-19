/** Public values shared by A2A providers, tools, and clients. @module @deepseek-ai/dsh-a2a/types */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable configured name of one remote Agent. */
export type A2AAgentId = Branded<'A2AAgentId'>

/** SHA-256 digest written as 64 lowercase hexadecimal characters. */
export type A2ASha256 = Branded<'A2ASha256'>

/** Opaque remote task identity. */
export type A2ATaskId = Branded<'A2ATaskId'>

/** Opaque handle for one file already stored by the remote Agent. */
export type A2AAttachmentId = Branded<'A2AAttachmentId'>

/** Configured remote Agent without transport secrets. */
export interface A2AAgentView {
  readonly id: A2AAgentId
  readonly endpoint: string
  readonly directUpload: boolean
}

/** One skill advertised by a standard A2A Agent Card. */
export interface A2ASkillView {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly tags: readonly string[]
  readonly examples: readonly string[]
  readonly inputModes: readonly string[]
  readonly outputModes: readonly string[]
}

/** Client-safe projection of an A2A Agent Card. */
export interface A2AAgentCardView {
  readonly agentId: A2AAgentId
  readonly name: string
  readonly description: string
  readonly version: string
  readonly protocolVersions: readonly string[]
  readonly streaming: boolean
  readonly directUpload: boolean
  readonly inputModes: readonly string[]
  readonly outputModes: readonly string[]
  readonly skills: readonly A2ASkillView[]
}

/** Metadata for one file that will be uploaded directly to a remote Agent. */
export interface A2APrepareUploadRequest {
  readonly agentId: A2AAgentId
  readonly name: string
  readonly mediaType: string
  readonly byteLength: number
  readonly sha256: A2ASha256
}

/** Short-lived single-use destination allocated by a remote Agent. */
export interface A2AUploadTicket {
  readonly agentId: A2AAgentId
  readonly attachmentId: A2AAttachmentId
  readonly uploadUrl: string
  readonly token: string
  readonly expiresAt: number
  readonly name: string
  readonly mediaType: string
  readonly byteLength: number
  readonly sha256: A2ASha256
}

/** Remote attachment reference included in an A2A message extension. */
export interface A2AAttachmentRef {
  readonly attachmentId: A2AAttachmentId
  readonly name: string
  readonly mediaType: string
  readonly byteLength: number
  readonly sha256: A2ASha256
}

/** Request to start or continue work on a remote Agent. */
export interface A2ASendRequest {
  readonly agentId: A2AAgentId
  readonly prompt: string
  readonly taskId?: A2ATaskId
  readonly contextId?: string
  readonly attachments?: readonly A2AAttachmentRef[]
}

/** Request for the latest state of one remote task. */
export interface A2AGetTaskRequest {
  readonly agentId: A2AAgentId
  readonly taskId: A2ATaskId
  readonly historyLength?: number
}

/** Text and structured metadata projected from one A2A Message or Task. */
export interface A2ATaskView {
  readonly kind: 'message' | 'task'
  readonly agentId: A2AAgentId
  readonly taskId?: A2ATaskId
  readonly contextId: string
  readonly state?: string
  readonly text: string
  readonly artifacts: readonly A2AArtifactView[]
}

/** One artifact returned by a remote Agent. */
export interface A2AArtifactView {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly parts: readonly A2APartView[]
}

/** JSON value accepted in a structured A2A data part. */
export type A2AJsonValue = null | boolean | number | string | readonly A2AJsonValue[] | { readonly [key: string]: A2AJsonValue }

/** Safe projection of a standard A2A Part. */
export type A2APartView =
  | { readonly kind: 'text'; readonly text: string; readonly mediaType: string }
  | { readonly kind: 'url'; readonly url: string; readonly name: string; readonly mediaType: string }
  | { readonly kind: 'data'; readonly data: A2AJsonValue; readonly mediaType: string }
  | { readonly kind: 'raw'; readonly bytes: number; readonly name: string; readonly mediaType: string }
