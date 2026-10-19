# ur-agents

A 3D hall for GitHub Copilot and local ChatGPT Codex agent sessions. A closed modernist room (plaster walls, a window band onto the city, an oak slat wall) with ten fixed desks. With more than ten sessions, working agents get desks first and the rest are listed in List view. Click an agent to read its activity history and open the original session in its app.

Copilot sessions are watched from the Copilot app and CLI data under `~/.copilot`. Once you install the bridge and switch **Control** on, ur-agents can send messages, stop work, answer questions and decide permission requests. Local Codex threads are listed through the official Codex App Server bundled with the ChatGPT desktop app; their stored turns and activity history appear in the same office, and **Open in ChatGPT** jumps to the original thread. See [Codex sessions](#chatgpt-and-codex-sessions), [Controlling Copilot agents](#controlling-copilot-agents) and [docs/PLAN.md](docs/PLAN.md).

On a normal launch, choose **GitHub Copilot** or **ChatGPT Codex** in the startup window. The last choice is highlighted and saved. Selecting a provider opens or activates its desktop app; the top-bar switcher stays visible afterward. Rooms, counters, desks and session details show only that provider. Copilot opens its supported Chats view; Codex opens the ChatGPT app. The provider registry can accept another source later; **Claude Code is not supported yet**.

## Install

Download the latest Windows installer from [GitHub Releases](https://github.com/xsqezz/ur-agents/releases/latest), or build it locally and run it:

```powershell
npm run dist          # out/installer/ur-agents-Setup-<version>.exe
```

The Setup (Squirrel) needs no admin rights: it installs to `%LOCALAPPDATA%\ur_agents`, adds a **Desktop** shortcut and a Start Menu entry, and starts the app. The window is frameless with rounded corners and its own minimize / maximize / close buttons: drag the top bar to move it, drag any edge or corner to resize. Only one window runs at a time (starting it again just brings it forward). Uninstall from Windows Settings > Apps; that removes the shortcuts and the bridge extension from `~/.copilot/extensions`, and leaves your settings and audit log in `%LOCALAPPDATA%\ur-agents`. The installer is not code-signed, so Windows SmartScreen may ask you to confirm ("More info" > "Run anyway").

## Run from source

```powershell
npm install
node node_modules/electron/install.js   # npm 12 blocks Electron's postinstall
npm start                               # GitHub Copilot + local ChatGPT Codex sessions
npm run demo                            # 14 synthetic agents cycling through every state
```

Build only the unpacked app (`out/ur-agents-win32-x64/ur-agents.exe`):

```powershell
npm run pack
```

Other scripts: `npm test`, `npm run typecheck`, `npm run icon` (regenerates `build/icon.ico`).

Flags: `--demo`, `--agents <model,model,…>` (with `--demo`: one synthetic agent per model), `--control` (demo: start with Control on), `--copilot-home <dir>`, `--view 3d|list`, `--select <n>`, `--room <id>`, `--launch` (open the New agent dialog), `--screenshot <file> [--delay <ms>]`, `--dump <file>` (writes the session list as JSON).

## Rooms

Copilot rooms follow the project folders in its Sessions sidebar, plus **Chats** and **Other sessions**. Codex threads are grouped into rooms by their local working folder. Every room has ten desks; the room name is painted on the floor.

Switch rooms by clicking one in the **Rooms** list on the left, with `PageUp` / `PageDown` (or `Alt+↑` / `Alt+↓`), or by selecting an agent that lives elsewhere (for example from a notification). A yellow badge on a room means agents there need you, a green one counts the agents working. Each room remembers which agent sits at which desk. The first room shown is the one you used last, otherwise the first with something going on.

**Every session of a folder keeps a desk**, however old: agents that are not running sit there asleep with their monitors dimmed (their last screen stays readable), working ones get desks first. A room shows up to twelve of its newest sessions; strays the app does not file under a folder appear in "Other sessions" for three days.

## Starting a new agent

Click a **free desk** (or press `N`, or use **New agent**) in a Copilot room to start an agent in that folder. Pick a prompt, model, reasoning effort, mode and permissions, and optionally a name. It runs the Copilot CLI one-shot in that folder. Select its desk and click **Open in Copilot** to jump to the same session in the GitHub Copilot app. To start a Codex task, use the ChatGPT desktop app as usual; it appears in its working-folder room when the local App Server lists it. Select it and choose **Open in ChatGPT** to continue there.

**Sign-in:** agents started from ur-agents run the Copilot CLI by themselves, so the CLI needs its own login. The GitHub Copilot app hands its login only to the sessions it starts, so if you have never run `copilot login`, the first start fails with "not signed in" and the dialog offers a **Sign in to Copilot** button (it opens the CLI's own device-code sign-in in a terminal). Do it once, then press Start again. A start counts as successful only when the agent has received its prompt; a failed one leaves nothing behind and its CLI output is kept in `%LOCALAPPDATA%\ur-agents\launches` for three days.

## What you see

A desk is **taken** by every session of the room. While its agent is thinking, using a tool, waiting for you, compacting, failed, done or stalled it is awake at its monitors; **idle** and **offline** agents sit there asleep, and only desks without a session stay empty. Desks are numbered and keep their session for as long as it is listed.

Every desk has **two monitors** that update live � an ultrawide screen straight ahead and a narrower 16:9 one stacked above it, with a light bar between them:

- **Left — Activity:** the agent's recent prompts, tool calls and results, newest at the bottom, with running / ok / failed marks.
- **Right — Focus:** what it is doing right now — the terminal command and its output, the file it is reading, the patch it is writing (green/red lines), web results, the sub-agents it started, the question it asks you, the permission it waits for, or its latest message while it thinks.

A working agent sits with its back to you, facing its monitors. When it needs you (question, permission, error) or has finished, it swivels round to face the room. Orbit the camera freely: a tall wall drops to a low sill while the camera is outside it, so no wall ever hides an agent (`--cam x,y,z --look x,y,z` places the camera exactly, for screenshots).

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

All figures share one body — a chunky vinyl-toy block with two glossy oval eyes, stubby side nubs and four short legs — and differ by colour and emblem (printed on the chest and on the back, so you can tell them apart while they face their screens): `claude-*` orange with a starburst, `gpt-*`/codex teal with a six-petal rosette, `gemini-*` rainbow gradient with a four-point sparkle, `grok-*` graphite with a slashed ring and "GROK", `mai-*` white with four coloured squares, `auto` (GitHub Copilot's automatic model selection) dark graphite with the white GitHub mark, anything else grey. The emblems are simple glyphs drawn in code, not the companies' official logos, except the GitHub mark, which is the MIT-licensed Octicon. The tier (haiku/mini → opus/sol) changes size and adds a star. State is always also written as text, and there is a **List** view for screen readers and low-end GPUs.

## Monthly AI credits

The bottom of the Rooms list shows your **monthly AI-credit budget**: credits used out of the total, what is left, and when it resets. The total includes your plan's **additional budget** (the extra credits you allow beyond the included ones): the bar shows the included part solid and the additional part striped, with a tick where the included credits end. It turns yellow at 80 % and red at 95 % of the whole budget and says "Limit reached" when both are used up.

The numbers come from `session.rpc.quota.get()`, which only a Copilot session can call with your login, so the **bridge** (see below) reports them: every ~2 minutes while a session with the bridge is open, and once when it connects. This needs no Control switch, only the bridge installed in `~/.copilot/extensions` (the card offers to install or update it). The last report is kept in `%LOCALAPPDATA%\ur-agents\quota.json`, so the card is filled right after the app starts and marks itself stale when it is old. The reset date is the first of next month (UTC) unless the runtime reports one, and a reset estimated that way is shown with `~`. If your plan has an additional budget of 0 it says "no additional budget". Demo mode shows synthetic numbers (`UR_DEMO_QUOTA=ok|warn|extra|none`).

## ChatGPT and Codex sessions

ur-agents starts the official `codex app-server --listen stdio://` process and uses its JSON-RPC API to list non-archived local threads and load recent turn history. It follows every cursor page and lets the server repair its thread index, so named Worktree tasks remain discoverable even when their preview is empty. It finds the CLI bundled with the ChatGPT desktop app or uses `codex` on `PATH`. This avoids reading Codex's private database or rollout files. Threads are identified by their local project folder. The **Chats** tab in the left sidebar lists every available thread by its full title, including child threads; **Rooms** keeps the project-folder view, and **All Codex threads** groups them in the main view.

Selecting **ChatGPT Codex** opens or activates the ChatGPT desktop app through its registered `codex://` link. If Windows has no handler installed, ur-agents reports the launch failure and keeps running.

This integration is read-only inside ur-agents. Use **Open in ChatGPT** to send a message, stop work or handle an approval. The App Server reports runtime status only for threads loaded in that server process, so an active thread already running in the desktop app may appear as saved/offline here while its history continues to update. Ordinary ChatGPT chats and remote/cloud tasks are not included; this source is for local Codex threads exposed by the App Server.

## Controlling Copilot agents

ur-agents can also **drive Copilot sessions**, so the GitHub Copilot app can stay in the background:

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
src/main      Electron main: Copilot reader/tailer, Codex App Server client, demo source, Copilot control, IPC
src/renderer  three.js office, procedural figures, detail panel with message box, list view
bridge        the extension that runs inside each Copilot session (Control)
test          node --test (runs the TypeScript directly)
```

Sources:

- `~/.copilot/session-state/<id>/events.jsonl` — only the last 2 MB is read at start, then appended lines are tailed.
- `~/.copilot/data.db` — opened `readOnly`; only an allowlist of columns from `sessions`, `workspaces` and `projects` is queried. Tables holding credentials are never touched.
- `inuse.<pid>.lock` + process check — tells "process alive" from "agent working".
- Codex thread list and turn history — read through the local Codex App Server API; ur-agents does not open Codex's private files directly.

Secrets (GitHub tokens, JWTs, private keys, bearer tokens) are redacted before anything reaches the UI. The renderer has no Node access; it only receives normalised events over IPC.

Limitations: Copilot does not persist token-by-token deltas, so "live" means per message / tool call; its event and database formats may change between releases. Codex history is polled from the local App Server, and a separate app-server process cannot subscribe to the desktop app's already-loaded runtime status. Codex controls stay in the ChatGPT app. Copilot Control relies on the Copilot SDK session RPC; if a future version removes it, the app reports that instead of failing silently.
