# `@deepseek-ai/dsh-tool-a2a`

English | [中文](README.zh.md)

Opt-in model tools over `ctx.a2a`: `a2a_discover` reads Agent Cards, `a2a_call` uploads selected local files through `ctx.fs` and sends an A2A task, and `a2a_task` reads task state and artifacts.

The tool never sends a local path to a remote Agent. It reads through the DSH filesystem service, computes SHA-256, reserves a short-lived one-use remote ticket, uploads bytes, and logs only the returned opaque attachment metadata in the A2A call. This keeps the model-visible request reconstructable without exposing a local path as a remote capability.

The tool reads raw bytes through the bounded `ctx.fs.readBytes` contract, using the configured A2A provider upload limit, so image and other binary files preserve their exact bytes. Resumable uploads are deferred. The browser UI does not invoke this tool; it only discovers Agents in Settings.

## Model Experience

### A2A tools

#### What the model sees

The model sees `a2a_discover`, `a2a_call`, and `a2a_task`. The system prompt asks it to discover an Agent first, pass local file paths to `a2a_call`, and use returned task ids with `a2a_task`. Results are structured JSON projected as text for Native mode; local paths are never sent to the remote Agent.

#### Token effect

Each tool call contributes its JSON result and the system prompt section to the next request. File bytes are uploaded out of band and do not consume prompt tokens.

#### KV Cache effect

The static tool descriptions and A2A guidance remain in the prompt prefix; changing a task result invalidates only the request suffix after the tool call.

## Known Limitations and Deferred Work

- The model-facing tool uploads complete files in one request; resumable uploads and large artifact storage are deferred.
- Remote skill code is not downloaded or installed, and the tool does not provide payment, marketplace, or trust scoring.
