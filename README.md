# ur-agents

A 3D hall for your GitHub Copilot agents. A closed modernist room (plaster walls, a window band onto the city, an oak slat wall) with exactly ten fixed desks (two rows of five; the row by the window is turned round, so its agents face the room). With more than ten sessions, working agents get desks first and the rest are listed in the List view. Every agent session claims a desk: while the agent works, a small vinyl-toy robot sits at it and its pose shows what it is doing; when the agent is idle or offline the chair is tucked in, the laptop is closed and the lamp is off. Click an agent to read everything about it and watch its events stream in live.

**Version 0.2 can watch and control** the agents. It reads what the Copilot app and CLI already write under `~/.copilot`, and (once you install the bridge and switch **Control** on) sends messages, Stop, answers and permission decisions back. See [Controlling agents](#controlling-agents) and [docs/PLAN.md](docs/PLAN.md).

## Install

Build the installer and run it:

```powershell
npm run dist          # out/installer/ur-agents-Setup-<version>.exe
```

The Setup (Squirrel) needs no admin rights: it installs to `%LOCALAPPDATA%\ur_agents`, adds a **Desktop** shortcut and a Start Menu entry, and starts the app. Only one window runs at a time (starting it again just brings it forward). Uninstall from Windows Settings > Apps; that removes the shortcuts and the bridge extension from `~/.copilot/extensions`, and leaves your settings and audit log in `%LOCALAPPDATA%\ur-agents`. The installer is not code-signed, so Windows SmartScreen may ask you to confirm ("More info" > "Run anyway").

## Run from source

```powershell
npm install
node node_modules/electron/install.js   # npm 12 blocks Electron's postinstall
npm start                               # live data from ~/.copilot
npm run demo                            # 14 synthetic agents cycling through every state
```

Build only the unpacked app (`out/ur-agents-win32-x64/ur-agents.exe`):

```powershell
npm run pack
```

Other scripts: `npm test`, `npm run typecheck`, `npm run icon` (regenerates `build/icon.ico`).

Flags: `--demo`, `--agents <model,model,…>` (with `--demo`: one synthetic agent per model), `--control` (demo: start with Control on), `--copilot-home <dir>`, `--view 3d|list`, `--select <n>`, `--room <id>`, `--launch` (open the New agent dialog), `--screenshot <file> [--delay <ms>]`, `--dump <file>` (writes the session list as JSON).

## Rooms

There is one hall per **session folder** of the GitHub Copilot app — the projects in its Sessions sidebar, in the same order, plus **Chats**. Sessions that belong to no listed folder land in an **Other sessions** room. Every room has its own ten desks; the room name is painted on the floor.

Switch rooms by clicking one in the **Rooms** list on the left, with `PageUp` / `PageDown` (or `Alt+↑` / `Alt+↓`), or by selecting an agent that lives elsewhere (for example from a notification). A yellow badge on a room means agents there need you, a green one counts the agents working. Each room remembers which agent sits at which desk. The first room shown is the one you used last, otherwise the first with something going on.

**Every session of a folder keeps a desk**, however old: agents that are not running sit there asleep with their monitors dimmed (their last screen stays readable), working ones get desks first. A room shows up to twelve of its newest sessions; strays the app does not file under a folder appear in "Other sessions" for three days.

## Starting a new agent

Click a **free desk** (or press `N`, or use **New agent**) to start an agent in the current room's folder. Pick what it should do, the model (any id; common ones are suggested), reasoning effort, mode (normal, plan first, autopilot) and permissions, optionally a name. It runs the Copilot CLI one-shot (`copilot --prompt …`) in that folder, so it works until the task is done and then goes offline; open it in the GitHub Copilot app to continue. Permissions are `--allow-all-tools` (stays inside the folder) or, after an extra confirmation, `--allow-all`. Needs **Control** switched on, at most six started agents run at once, and the session is filed under its room through a small `launched.json` next to the bridge data.

## What you see

A desk is **taken** by every session of the room. While its agent is thinking, using a tool, waiting for you, compacting, failed, done or stalled it is awake at its monitors; **idle** and **offline** agents sit there asleep, and only desks without a session stay empty. Desks are numbered and keep their session for as long as it is listed.

Every desk has **two monitors** that update live � an ultrawide screen straight ahead and a narrower 16:9 one stacked above it, with a light bar between them:

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

All figures share one body — a chunky vinyl-toy block with two glossy oval eyes, stubby side nubs and four short legs — and differ by colour and emblem (printed on the chest and on the back, so you can tell them apart while they face their screens): `claude-*` orange with a starburst, `gpt-*`/codex teal with a six-petal rosette, `gemini-*` rainbow gradient with a four-point sparkle, `grok-*` graphite with a slashed ring and "GROK", `mai-*` white with four coloured squares, anything else grey. The emblems are simple glyphs drawn in code, not the companies' official logos. The tier (haiku/mini → opus/sol) changes size and adds a star. State is always also written as text, and there is a **List** view for screen readers and low-end GPUs.

## Controlling agents

ur-agents can also **drive** your sessions, so the GitHub Copilot app can stay in the background:

- **Message** an agent (Enter sends; “Interrupt now” sends it immediately instead of queueing it).
- **Stop** the agent's current work.
- **Answer** its questions (choices or free text) and **approve / reject** its permission requests — shown as cards above the message box, with the full command.

How it works: a tiny extension (`bridge/`, no dependencies, no network except `127.0.0.1`) runs inside each Copilot CLI session, reports what the session is waiting for and executes the commands the app sends. It registers no tools or hooks and does not touch the session's own approval handling.

Set it up once:

1. Open an agent and press **Install bridge** (copies three files into `~/.copilot/extensions/ur-agents-bridge`; **Update bridge** after an upgrade).
2. Turn on **Control** in the top bar and confirm. It is **off by default** and stays off until you switch it on.
3. New sessions load the bridge automatically. A session that was already running needs its extensions reloaded (`/clear` in the CLI) or a restart; until then it stays watch-only and says so.

Safety:

- The app listens on `127.0.0.1` only, with a random token (stored in `%LOCALAPPDATA%\ur-agents\bridge.json`, per run), rejects browser origins and wrong hosts, and only accepts five validated command types.
- Permission approvals are always an explicit click on a card that shows the exact command; there is no auto-approve.
- Every command (what, which session, ok/failed) is appended to `%LOCALAPPDATA%\ur-agents\audit.jsonl`; message bodies are cut to 80 characters there.
- If something else already answered a question or permission (for example in the Copilot app), the app tells you instead of acting twice.

In `--demo` mode every synthetic agent reacts to commands (add `--control` to start with Control on), so you can try the whole flow safely.

## How it works

```
src/core      parser + state machine (no I/O) — folds Copilot CLI events into an agent state
src/main      Electron main: read-only data.db reader, events.jsonl tailer, demo source, control server, IPC
src/renderer  three.js office, procedural figures, detail panel with message box, list view
bridge        the extension that runs inside each Copilot session (Control)
test          node --test (runs the TypeScript directly)
```

Sources (all read-only):

- `~/.copilot/session-state/<id>/events.jsonl` — only the last 2 MB is read at start, then appended lines are tailed.
- `~/.copilot/data.db` — opened `readOnly`; only an allowlist of columns from `sessions`, `workspaces` and `projects` is queried. Tables holding credentials are never touched.
- `inuse.<pid>.lock` + process check — tells "process alive" from "agent working".

Secrets (GitHub tokens, JWTs, private keys, bearer tokens) are redacted before anything reaches the UI. The renderer has no Node access; it only receives normalised events over IPC.

Limitations: the CLI does not persist token-by-token deltas, so "live" means per message / tool call. Event and database formats are internal to the Copilot app and may change between releases. Control relies on the experimental session RPC of the Copilot SDK (`ui.handlePendingUserInput`, `permissions.handlePendingPermissionRequest`); if a future version removes it, the app reports that instead of failing silently. Reading stays read-only; only Control writes anything, and only through the SDK.