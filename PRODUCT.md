# Product

## Register

product

## Users

One power user who runs several GitHub Copilot agents and local Codex tasks in parallel, then glances at a second monitor between tasks. Wants to know in two seconds which agent needs them, which is stuck and which is burning budget, then open any session in its original app and follow its work.

## Product Purpose

A local, multi-provider "mission control" for GitHub Copilot and local ChatGPT Codex threads, presented as a 3D office of toy robots. Success: a glance at the window answers "who is working, who is waiting for me, who failed"; a click gives the available activity history and opens the original session. Copilot control uses its official extension bridge. Codex is read-only in ur-agents; replies, stop requests and approvals stay in the ChatGPT app.

The user chooses one provider at a time. Session lists, rooms, counters, and details stay scoped to that choice. Codex exposes an All threads room and a complete List view for its local and Worktree threads, while ur-agents opens or activates the matching desktop app. The provider registry can grow; Claude Code is a future option, not a supported source today.

## Brand Personality

Playful but exact. Chunky vinyl-toy figures in a strictly black-and-white world (interface, room and light are neutral greys); colour is reserved for the figures and for state (green working, yellow asking, red error, blue done); all text, numbers and states stay crisp and readable. Charm lives in the figures, precision lives in the panels.

## Anti-references

- Enterprise dashboards with hero metrics and identical cards.
- Neon "AI" purple gradients and glassmorphism.
- Pixel-art nostalgia (rejected in favour of 3D toys).
- Copying any company's mascot or logo 1:1.

## Design Principles

1. State is never colour alone: every state has a pose, an icon and a text label.
2. The figures carry the glance, the panel carries the detail.
3. Read-only by default; anything that changes an agent must be explicit and auditable.
4. Honest data: show what the logs prove, say so when something is unknown.
5. Keyboard and list view are first-class, not fallbacks.

## Accessibility & Inclusion

WCAG AA for panels, `prefers-reduced-motion` freezes figures into static poses, a 2D list view mirrors every capability, attention changes are announced through an `aria-live` region.
