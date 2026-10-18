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
