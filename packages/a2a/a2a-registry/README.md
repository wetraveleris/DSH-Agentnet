# `@deepseek-ai/dsh-a2a-registry`

English | [中文](README.zh.md)

Small deployment service for discovering equal-peer DSH Agents. A peer registers an Agent Card URL, A2A endpoint, upload endpoint, and declared skill ids. Heartbeats renew a lease; expired peers disappear from discovery without a central task executor.

The registry does not run Agent tasks and does not install remote code. A caller uses a returned record to fetch the Agent Card and then calls the peer through the existing A2A client. Registration writes an optional atomic JSON state file, which is sufficient for one experimental registry instance; production deployments should move the store behind a shared database.

## HTTP API

```text
POST   /v1/agents/register              Bearer registration token
POST   /v1/agents/:id/heartbeat         Bearer registration token
DELETE /v1/agents/:id                   Bearer registration token
GET    /v1/agents?skill=image-analysis  public or discovery token
GET    /v1/agents/:id                   public or discovery token
GET    /healthz
```

Run the binary with `DSH_A2A_REGISTRY_TOKEN` (at least 16 characters), `DSH_A2A_REGISTRY_HOST`, `DSH_A2A_REGISTRY_PORT`, `DSH_A2A_REGISTRY_PUBLIC_URL`, and `DSH_A2A_REGISTRY_DATA`. Set `DSH_A2A_REGISTRY_DISCOVERY_TOKEN` when discovery is private. Registration and discovery tokens must differ because clients need only discovery access. Put TLS, rate limiting, and a deployment-specific identity provider in front of the HTTP process before exposing it publicly.

## Model Experience

None, as this is a deployment service. The model-facing `tool-a2a` package searches it through `A2AClientService`, then calls a discovered Peer through the same A2A client.

#### KV Cache effect

None; registry responses are outside model prompt assembly.

## Known Limitations and Deferred Work

- The first store is a single-process JSON file and is not a multi-instance database.
- Registration tokens are deployment credentials, not per-user billing or reputation identities.
