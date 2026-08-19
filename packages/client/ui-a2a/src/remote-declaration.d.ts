import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'

declare module '@deepseek-ai/dsh-a2a-client/remote' {
  const contribution: TypertRemoteContribution
  export default contribution
}
