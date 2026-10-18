import type { ToolCategory } from './types.ts';
import { redact } from './redact.ts';

const SHELL = new Set(['powershell', 'read_powershell', 'stop_powershell', 'bash', 'read_bash', 'write_powershell', 'write_bash', 'stop_bash']);
const READ = new Set(['view', 'rg', 'grep', 'glob', 'list_dir', 'lsp']);
const WRITE = new Set(['edit', 'apply_patch', 'create', 'write']);
const WEB = new Set(['web_fetch', 'web_search']);

export function categoryOf(tool: string): ToolCategory {
  if (SHELL.has(tool)) return 'shell';
  if (READ.has(tool)) return 'read';
  if (WRITE.has(tool)) return 'write';
  if (WEB.has(tool)) return 'web';
  if (tool === 'task' || tool === 'read_agent' || tool === 'write_agent' || tool === 'list_agents') return 'task';
  if (tool === 'ask_user') return 'input';
  return 'other';
}

function oneLine(text: string, max = 140): string {
  const flat = redact(text).replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function patchTarget(patch: string): string {
  const m = patch.match(/\*\*\* (?:Update|Add|Delete) File: (.+)/);
  return m ? m[1].trim() : 'patch';
}

/** Short human label describing what a tool call is doing. */
export function summarizeTool(tool: string, args: any): string {
  const a = args && typeof args === 'object' ? args : {};
  switch (tool) {
    case 'powershell':
    case 'bash':
      return oneLine(String(a.command ?? a.description ?? tool));
    case 'read_powershell':
    case 'read_bash':
      return `reading shell output ${a.shellId ?? ''}`.trim();
    case 'view':
    case 'edit':
    case 'create':
      return oneLine(String(a.path ?? tool));
    case 'apply_patch':
      return `patch ${oneLine(patchTarget(typeof args === 'string' ? args : JSON.stringify(args ?? '')), 100)}`;
    case 'rg':
    case 'grep':
      return `search “${oneLine(String(a.pattern ?? ''), 80)}”`;
    case 'glob':
      return `find ${oneLine(String(a.pattern ?? ''), 80)}`;
    case 'web_fetch':
      return oneLine(String(a.url ?? 'fetch'));
    case 'web_search':
      return `search the web: ${oneLine(String(a.query ?? ''), 90)}`;
    case 'task':
      return oneLine(String(a.description ?? a.name ?? 'sub-agent'));
    case 'sql':
      return oneLine(String(a.description ?? a.query ?? 'sql'));
    case 'ask_user':
      return oneLine(String(a.question ?? 'question'), 200);
    case 'task_complete':
      return 'finishing the task';
    case 'report_intent':
      return oneLine(String(a.intent ?? 'intent'));
    case 'skill':
      return `skill ${oneLine(String(a.skill ?? ''), 60)}`;
    default: {
      const first = Object.values(a).find((v) => typeof v === 'string') as string | undefined;
      return first ? `${tool}: ${oneLine(first, 100)}` : tool;
    }
  }
}

export function summarizePermission(req: any): { kind: string; text: string } {
  const r = req && typeof req === 'object' ? req : {};
  const kind = String(r.kind ?? 'permission');
  const text =
    r.fullCommandText ?? r.command ?? r.path ?? r.fileName ?? r.url ?? r.toolName ?? r.intention ?? r.title ?? '';
  return { kind, text: oneLine(String(text), 200) };
}
