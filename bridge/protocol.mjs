import os from 'node:os';
import path from 'node:path';

export const PROTOCOL_VERSION = 1;
export const MAX_TEXT = 20000;
export const MAX_ID = 200;

/** Where the app keeps its private files (bridge.json with the port and token, settings, audit log). */
export function dataDir() {
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'ur-agents');
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'ur-agents');
}

/** Reduces the runtime's quota projection to the few numbers the app shows. Returns null when it has no budget. */
export function reduceQuota(projection, now = Date.now()) {
  const p = projection && typeof projection === 'object' ? projection : {};
  const quotas = Array.isArray(p.providerQuotas) ? p.providerQuotas : [];
  const own = quotas.find((q) => q && q.provider && q.provider.kind === 'copilot' && q.budgetMetadata) ?? quotas.find((q) => q && q.budgetMetadata);
  const m = own?.budgetMetadata;
  const snap = p.snapshots?.premium_interactions ?? Object.values(p.snapshots ?? {}).find(Boolean);
  const entitlement = m?.entitlement ?? snap?.entitlementRequests;
  const consumed = m?.consumed ?? snap?.usedRequests;
  if (typeof entitlement !== 'number' || typeof consumed !== 'number') return null;
  return {
    unit: own?.unit ?? 'ai_credits',
    entitlement,
    consumed,
    overage: m?.overage ?? snap?.overage ?? 0,
    overageLimit: m?.overageLimit ?? snap?.overageEntitlement ?? 0,
    overageAllowed: (m?.overageAllowedWhenExhausted ?? snap?.overageAllowedWithExhaustedQuota) === true,
    unlimited: m?.unlimited === true || snap?.isUnlimitedEntitlement === true,
    plan: typeof p.planTier === 'string' ? p.planTier : undefined,
    resetAt: typeof snap?.resetDateEpochMs === 'number' ? snap.resetDateEpochMs : undefined,
    observedAt: Date.parse(own?.observedAt ?? '') || now,
  };
}

/** Commands the app may send to a session through the bridge. Anything else is refused. */
export const COMMAND_TYPES = ['send', 'abort', 'answer', 'permission', 'setModel'];

const str = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;

/** Validates and normalises a command. Returns { ok: true, cmd } or { ok: false, error }. */
export function validateCommand(c) {
  if (!c || typeof c !== 'object') return { ok: false, error: 'command must be an object' };
  switch (c.type) {
    case 'send':
      if (!str(c.text, MAX_TEXT)) return { ok: false, error: `text must be 1..${MAX_TEXT} characters` };
      return { ok: true, cmd: { type: 'send', text: c.text, interrupt: c.interrupt === true } };
    case 'abort':
      return { ok: true, cmd: { type: 'abort' } };
    case 'answer':
      if (!str(c.requestId, MAX_ID)) return { ok: false, error: 'requestId required' };
      if (typeof c.answer !== 'string' || c.answer.length === 0 || c.answer.length > MAX_TEXT) return { ok: false, error: 'answer required' };
      return { ok: true, cmd: { type: 'answer', requestId: c.requestId, answer: c.answer, freeform: c.freeform !== false } };
    case 'permission':
      if (!str(c.requestId, MAX_ID)) return { ok: false, error: 'requestId required' };
      if (c.decision !== 'approve' && c.decision !== 'reject') return { ok: false, error: 'decision must be approve or reject' };
      return { ok: true, cmd: { type: 'permission', requestId: c.requestId, decision: c.decision } };
    case 'setModel':
      if (!str(c.model, 100) || !/^[A-Za-z0-9._:/-]+$/.test(c.model)) return { ok: false, error: 'invalid model id' };
      return { ok: true, cmd: { type: 'setModel', model: c.model } };
    default:
      return { ok: false, error: 'unknown command type' };
  }
}

/** One-line description used for the audit log (never contains the full message body). */
export function describeCommand(cmd) {
  switch (cmd.type) {
    case 'send':
      return `send${cmd.interrupt ? ' (interrupt)' : ''}: ${cmd.text.replace(/\s+/g, ' ').slice(0, 80)}`;
    case 'abort':
      return 'abort';
    case 'answer':
      return `answer ${cmd.requestId.slice(0, 8)}: ${cmd.answer.replace(/\s+/g, ' ').slice(0, 60)}`;
    case 'permission':
      return `permission ${cmd.requestId.slice(0, 8)}: ${cmd.decision}`;
    case 'setModel':
      return `setModel ${cmd.model}`;
    default:
      return String(cmd.type);
  }
}
