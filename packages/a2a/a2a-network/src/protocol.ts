/** Wire frames between an A2A Relay and an outbound A2A node. */

/** Request forwarded from the public Relay to a node-owned loopback Gateway. */
export interface TunnelRequestFrame {
  readonly type: 'request'
  readonly id: string
  readonly method: string
  readonly path: string
  readonly headers: Readonly<Record<string, string>>
  readonly body: string
}

/** Response forwarded from a node-owned loopback Gateway to the public Relay. */
export interface TunnelResponseFrame {
  readonly type: 'response'
  readonly id: string
  readonly status: number
  readonly headers: Readonly<Record<string, string>>
  readonly body: string
}

/** Frame sent when a node cannot execute a Relay request. */
export interface TunnelFailureFrame {
  readonly type: 'failure'
  readonly id: string
  readonly message: string
}

/** One valid Relay tunnel response. */
export type TunnelNodeFrame = TunnelResponseFrame | TunnelFailureFrame
