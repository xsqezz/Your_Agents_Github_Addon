import { validateCommand } from '../../bridge/protocol.mjs';
import type { ControlResult, ControlSession, ControlState, Controller, PendingItem } from '../core/control.ts';
import type { Quota } from '../core/quota.ts';
import type { DemoSource } from './demo.ts';

/** Synthetic budget: the included credits are used up and the additional budget is being drawn on (UR_DEMO_QUOTA=ok|warn|extra|none changes it). */
function demoQuota(): Quota | undefined {
  const mode = process.env.UR_DEMO_QUOTA || 'extra';
  if (mode === 'none') return undefined;
  const consumed = mode === 'ok' ? 31_240 : mode === 'warn' ? 51_870 : 61_840;
  const entitlement = 60_000;
  return {
    unit: 'ai_credits',
    entitlement,
    consumed,
    overage: Math.max(0, consumed - entitlement),
    overageLimit: mode === 'extra' ? 5_000 : 0,
    overageAllowed: true,
    unlimited: false,
    plan: 'business',
    observedAt: Date.now() - 40_000,
  };
}

/** Control for demo mode: every synthetic agent "has a bridge" and reacts to commands, so the chat UI can be tried safely. */
export class DemoControl implements Controller {
  private demo: DemoSource;
  private onChange: () => void;
  private enabled = false;

  constructor(demo: DemoSource, onChange: () => void) {
    this.demo = demo;
    this.onChange = onChange;
  }

  async start(): Promise<void> {
    setInterval(() => this.onChange(), 1000).unref();
  }

  stop(): void {}

  state(): ControlState {
    const sessions: Record<string, ControlSession> = {};
    for (const s of this.demo.summaries()) {
      const pending: PendingItem[] = [];
      if (s.pending && s.state === 'awaiting-permission') pending.push({ kind: 'permission', requestId: `${s.id}:perm`, label: s.pending.kind, text: s.pending.text });
      if (s.pending && s.state === 'awaiting-input') pending.push({ kind: 'input', requestId: `${s.id}:ask`, text: s.pending.text, choices: ['Postgres 17', 'SQLite'], allowFreeform: true });
      sessions[s.id] = { connected: true, pending };
    }
    return { enabled: this.enabled, install: 'current', demo: true, installDir: '(demo)', sessions, quota: demoQuota() };
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.onChange();
  }

  install(): ControlResult {
    return { ok: true };
  }

  uninstall(): ControlResult {
    return { ok: true };
  }

  async send(sessionId: string, raw: unknown): Promise<ControlResult> {
    if (!this.enabled) return { ok: false, error: 'Control is switched off.' };
    const v = validateCommand(raw);
    if (!v.ok) return { ok: false, error: v.error };
    const c = v.cmd;
    const ok =
      c.type === 'send' ? this.demo.respond(sessionId, 'send', c.text)
      : c.type === 'answer' ? this.demo.respond(sessionId, 'answer', c.answer)
      : c.type === 'permission' ? this.demo.respond(sessionId, 'permission', c.decision)
      : c.type === 'abort' ? this.demo.respond(sessionId, 'abort')
      : true;
    return ok ? { ok: true } : { ok: false, error: 'Unknown demo agent.' };
  }
}
