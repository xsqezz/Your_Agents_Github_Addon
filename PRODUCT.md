# Product

## Register

product

## Users

One power user who runs several GitHub Copilot agents, local Codex chats and hosted Codex API tasks in parallel, then glances at a second monitor between tasks. Wants to know in two seconds which agent needs them, which is stuck and which is burning budget, then open or control a session in the place that supports it.

## Product Purpose

A local, multi-provider "mission control" for GitHub Copilot and ChatGPT Codex sessions, presented as a 3D office of toy robots. Codex includes local App Server threads and separately billed hosted API tasks. Success: a glance at the window answers "who is working, who is waiting for me, who failed"; a click gives the available activity history and provider-supported controls. Copilot control uses its official extension bridge. Local Codex remains read-only in ur-agents; Codex API tasks can be started, continued and cancelled from the app.

The user chooses one provider at a time. Session lists, rooms, counters, and details stay scoped to that choice. Codex exposes local threads and hosted API tasks in its Chats view. The first Codex selection asks for an API key; hosted API sessions use a locally encrypted key and remain separate from local App Server threads. Selecting Copilot or Codex opens the matching desktop app. The provider registry can grow.

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
