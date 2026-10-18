# ur-agents

A 3D hall for your GitHub Copilot agents. A modernist hall with ten fixed desks (more rows of five if you ever have more than ten sessions). Every agent session claims a desk: while the agent works, a small vinyl-toy robot sits at it and its pose shows what it is doing; when the agent is idle or offline the chair is tucked in, the laptop is closed and the lamp is off. Click an agent to read everything about it and watch its events stream in live.

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

Flags: `--demo`, `--agents <model,model,…>` (with `--demo`: one synthetic agent per model), `--copilot-home <dir>`, `--view list`, `--select <n>`, `--screenshot <file> [--delay <ms>]`, `--dump <file>` (writes the session list as JSON).

## What you see

A desk is **occupied** while its agent is thinking, using a tool, waiting for you, compacting, failed, done or stalled. **Idle** and **offline** agents leave it empty (their name tag stays so you can still click them). Desks are numbered and keep their session for as long as it is listed.

Every desk has **two large monitors** that update live:

- **Left — Activity:** the agent's recent prompts, tool calls and results, newest at the bottom, with running / ok / failed marks.
- **Right — Focus:** what it is doing right now — the terminal command and its output, the file it is reading, the patch it is writing (green/red lines), web results, the sub-agents it started, the question it asks you, the permission it waits for, or its latest message while it thinks.

A working agent sits with its back to you, facing its monitors. When it needs you (question, permission, error) or has finished, it swivels round to face the room.

| State | Figure |
|---|---|
| Idle / offline | empty desk: chair tucked in, monitors off |
| Thinking | chin on hand; right monitor shows its latest message |
| Terminal / reading / editing / web | typing / paper / pen / globe; monitors show the matching view |
| Delegating | smaller figures of the sub-agents sit beside the desk |
| Needs your answer | turns to you, hand up |
| Needs permission | turns to you, holds an "OK?" sign |
| Compacting | squashes, packing boxes |
| Error | turns to you, red, X eyes, smoke |
| Done | turns to you, cheering |
| Stalled | grey and frozen |

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