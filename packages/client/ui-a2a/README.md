# `@deepseek-ai/dsh-client-ui-a2a`

English | [中文](README.zh.md)

Browser settings contribution for the opt-in A2A capability. It mounts the generated A2A Remote, lists Agents configured by the Host profile, and reads Agent Cards to display their standard skills and transport capabilities.

Settings is a network-management and discovery surface only. It does not submit tasks or upload files. Tasks continue to start in the main conversation composer; Standard mode exposes `a2a_discover`, `a2a_call`, and `a2a_task` through the Host so the normal agent loop can choose a joined Agent when the task requires it.

The Host still owns endpoint configuration, credentials, direct-upload transport, and the A2A SDK. The browser never receives configured authentication headers.

## Model Experience

None, as this package contributes settings presentation. Model-visible behavior belongs to `@deepseek-ai/dsh-tool-a2a`.

#### KV Cache effect

None; browser state is not part of a model request prefix.

## Known Limitations and Deferred Work

- The UI does not edit Agent endpoint configuration or store credentials; those remain Host/profile settings.
- Agent Card refresh is explicit through the Read Agent Card action; streaming status and artifact browsing remain model-facing or deployment-specific concerns.
