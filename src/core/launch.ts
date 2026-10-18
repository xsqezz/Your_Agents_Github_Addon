export const LAUNCH_MODES = ['interactive', 'plan', 'autopilot'] as const;
export const LAUNCH_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
/** tools: every tool is auto-approved but file access stays in the folder. full: no checks at all. */
export const LAUNCH_ACCESS = ['tools', 'full'] as const;

export type LaunchMode = (typeof LAUNCH_MODES)[number];
export type LaunchEffort = (typeof LAUNCH_EFFORTS)[number];
export type LaunchAccess = (typeof LAUNCH_ACCESS)[number];

export const MAX_PROMPT = 8000;

/** Suggestions only: the model field accepts any id the CLI knows. */
export const MODEL_SUGGESTIONS = [
  'claude-sonnet-5.5', 'claude-sonnet-5', 'claude-opus-5.5', 'claude-opus-5', 'claude-opus-4.8', 'claude-haiku-5.5', 'claude-haiku-4.5',
  'gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna', 'gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5-mini',
  'gemini-4-argon', 'gemini-3.8-flash', 'gemini-3.7-flash',
  'grok-4.7', 'grok-4.6', 'grok-4.5',
  'mai-code-1.1-flash',
];

export interface LaunchRequest {
  room: string;
  prompt: string;
  model?: string;
  mode: LaunchMode;
  effort?: LaunchEffort;
  access: LaunchAccess;
  name?: string;
}

export interface LaunchResult {
  ok: boolean;
  sessionId?: string;
  error?: string;
  note?: string;
}

const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/;

function oneOf<T extends string>(list: readonly T[], v: unknown): T | undefined {
  return typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : undefined;
}

/** Validates what the renderer sends; nothing else ever reaches a command line. */
export function parseLaunch(input: unknown): { ok: true; req: LaunchRequest } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Malformed request.' };
  const r = input as Record<string, unknown>;
  if (typeof r.room !== 'string' || !r.room || r.room.length > 100) return { ok: false, error: 'Pick a room first.' };
  const prompt = typeof r.prompt === 'string' ? r.prompt.trim() : '';
  if (!prompt) return { ok: false, error: 'Write what the agent should do.' };
  if (prompt.length > MAX_PROMPT) return { ok: false, error: `The prompt is longer than ${MAX_PROMPT} characters.` };
  const model = typeof r.model === 'string' ? r.model.trim() : '';
  if (model && !MODEL_RE.test(model)) return { ok: false, error: 'That model id looks wrong.' };
  const mode = r.mode === undefined || r.mode === '' ? 'interactive' : oneOf(LAUNCH_MODES, r.mode);
  if (!mode) return { ok: false, error: 'Unknown mode.' };
  const effort = r.effort === undefined || r.effort === '' ? undefined : oneOf(LAUNCH_EFFORTS, r.effort);
  if (r.effort !== undefined && r.effort !== '' && !effort) return { ok: false, error: 'Unknown reasoning effort.' };
  const access = r.access === undefined ? 'tools' : oneOf(LAUNCH_ACCESS, r.access);
  if (!access) return { ok: false, error: 'Unknown permission level.' };
  const name = typeof r.name === 'string' ? r.name.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
  return { ok: true, req: { room: r.room, prompt, model: model || undefined, mode, effort, access, name: name || undefined } };
}

/** Arguments for a one-shot Copilot CLI run. The prompt is bound with `=` so a leading dash can never be read as a flag. */
export function buildArgs(req: LaunchRequest, sessionId: string): string[] {
  const args = ['--session-id', sessionId, `--prompt=${req.prompt}`, '--mode', req.mode, '--no-auto-update', '--no-ask-user', '--no-color'];
  args.push(req.access === 'full' ? '--allow-all' : '--allow-all-tools');
  if (req.model) args.push('--model', req.model);
  if (req.effort) args.push('--reasoning-effort', req.effort);
  if (req.name) args.push(`--name=${req.name}`);
  return args;
}
