/** Minimal client-side Remote surface consumed by the settings page. */
import type { A2AAgentCardView, A2AAgentView } from '@deepseek-ai/dsh-a2a'

/** Result envelope returned by a Typert Remote call. */
export interface A2ARemoteResult<T> { ok: boolean; value?: T; error?: { message: string } }
/** Browser-safe subset of the generated A2A Remote. */
export interface A2ARemoteApi {
  list(): Promise<A2ARemoteResult<readonly A2AAgentView[]>>
  search(skill?: string): Promise<A2ARemoteResult<readonly A2AAgentView[]>>
  discover(id: string): Promise<A2ARemoteResult<A2AAgentCardView>>
}
