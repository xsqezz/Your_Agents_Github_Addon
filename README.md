# ur-agents

A 3D office for your GitHub Copilot agents. Every agent session is a small vinyl-toy robot sitting at its own desk; its pose and expression show what it is doing right now. Click one to read everything about it and watch its events stream in live.

**Version 0.1 is read-only**: it only reads what the Copilot app and CLI already write under `~/.copilot`. Controlling agents (send a message, stop, answer, approve) is planned — see [docs/PLAN.md](docs/PLAN.md).

## Run

```powershell
npm install
node node_modules/electron/install.js   # npm 12 blocks Electron's postinstall
npm start                               # live data from ~/.copilot
npm run demo                            # 14 synthetic agents cycling through every state
```

Build a Windows `.exe` (folder `out/ur-agents-win32-x64/ur-agents.exe`):

```powershell
npm run pack
```

Other scripts: `npm test`, `npm run typecheck`.

Flags: `--demo`, `--copilot-home <dir>`, `--view list`, `--select <n>`, `--screenshot <file> [--delay <ms>]`, `--dump <file>` (writes the session list as JSON).

## What you see

| State | Figure |
|---|---|
| Idle | dozing (Zzz) |
| Thinking | chin on hand, "…" bubble |
| Terminal / reading / editing / web | typing / paper and magnifier / pen / globe |
| Delegating | smaller figures of the sub-agents sit beside the desk |
| Needs your answer | hand up, "!" |
| Needs permission | holds an "OK?" sign |
| Compacting | squashes, packing boxes |
| Error | red, X eyes, smoke |
| Done | cheering |
| Offline / stalled | empty chair / grey and frozen |

The figure's look follows the model family (`claude-*` orange block, `gpt-*`/codex dark robot with headphones, `gemini-*` blue with lobes, `grok-*` graphite with a slash visor, `mai-*` teal, anything else grey). The tier (haiku/mini → opus/sol) changes size and adds a star. State is always also written as text, and there is a **List** view for screen readers and low-end GPUs.

## How it works

```
src/core      parser + state machine (no I/O) — folds Copilot CLI events into an agent state
src/main      Electron main: read-only data.db reader, events.jsonl tailer, demo source, IPC
src/renderer  three.js office, procedural figures, detail panel, list view
test          node --test (runs the TypeScript directly)
```

Sources (all read-only):

- `~/.copilot/session-state/<id>/events.jsonl` — only the last 2 MB is read at start, then appended lines are tailed.
- `~/.copilot/data.db` — opened `readOnly`; only an allowlist of columns from `sessions`, `workspaces` and `projects` is queried. Tables holding credentials are never touched.
- `inuse.<pid>.lock` + process check — tells "process alive" from "agent working".

Secrets (GitHub tokens, JWTs, private keys, bearer tokens) are redacted before anything reaches the UI. The renderer has no Node access; it only receives normalised events over IPC.

Limitations: the CLI does not persist token-by-token deltas, so "live" means per message / tool call. Event and database formats are internal to the Copilot app and may change between releases.