# Product

## Register

product

## Users

One power user who runs several GitHub Copilot agents in parallel (autopilot, orchestrated child sessions) and glances at a second monitor between tasks. Wants to know in two seconds which agent needs them, which is stuck and which is burning budget, then open any agent and follow its work live.

## Product Purpose

A local, read-only "mission control" for the GitHub Copilot app, presented as a 3D office of toy robots. Success: a glance at the window answers "who is working, who is waiting for me, who failed"; a click gives the full detail and a live event stream. Control of agents (send, stop, answer, approve) comes later through an official extension bridge.

## Brand Personality

Playful but exact. Chunky vinyl-toy figures and warm desk lamps in a dark night-shift office; all text, numbers and states stay crisp and readable. Charm lives in the figures, precision lives in the panels.

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
