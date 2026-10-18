import type { AgentState, SessionSummary, ToolCategory } from '../core/types.ts';

export const STATE_COLOR: Record<AgentState, string> = {
  idle: '#8a8a8a',
  thinking: '#3ddc97',
  tool: '#3ddc97',
  'awaiting-input': '#ffc247',
  'awaiting-permission': '#ffc247',
  compacting: '#3ddc97',
  error: '#ff5a6e',
  done: '#4da3ff',
  offline: '#444444',
  stalled: '#8f8f8f',
};

export const STATE_LABEL: Record<AgentState, string> = {
  idle: 'Idle',
  thinking: 'Thinking',
  tool: 'Working',
  'awaiting-input': 'Needs your answer',
  'awaiting-permission': 'Needs permission',
  compacting: 'Compacting',
  error: 'Error',
  done: 'Done',
  offline: 'Offline',
  stalled: 'Stalled',
};

export const STATE_ICON: Record<AgentState, string> = {
  idle: '○',
  thinking: '…',
  tool: '▶',
  'awaiting-input': '?',
  'awaiting-permission': '!',
  compacting: '⇵',
  error: '✕',
  done: '✓',
  offline: '–',
  stalled: '‖',
};

const CATEGORY_LABEL: Record<ToolCategory, string> = {
  shell: 'In terminal',
  read: 'Reading',
  write: 'Editing',
  web: 'On the web',
  task: 'Delegating',
  input: 'Asking you',
  other: 'Working',
};

export function stateText(s: Pick<SessionSummary, 'state' | 'category'>): string {
  return s.state === 'tool' && s.category ? CATEGORY_LABEL[s.category] : STATE_LABEL[s.state];
}

export const NEEDS_YOU: AgentState[] = ['awaiting-input', 'awaiting-permission', 'error'];

/** A desk is occupied while its agent is actually doing something; idle and offline agents leave it empty. */
export function isOccupied(state: AgentState): boolean {
  return state !== 'idle' && state !== 'offline';
}

export function ago(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d`;
}

export function duration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}
