import { familyOf, tierOf } from '../core/family.ts';
import { redact, safeText, truncate } from '../core/redact.ts';
import type { AgentState, FeedItem, RoomInfo, SessionDetail, SessionSummary, Snapshot, TimelineItem } from '../core/types.ts';
import type { Source, SourceInfo } from './source.ts';
import { AgentsApiKeyStore } from './agents-api-key.ts';

const BASE = 'https://api.openai.com/v1/agents';
const ROOM_ID = 'codex:api';
const SESSION_ID = 'codex-api:';
const POLL_MS = 4000;
const DETAIL_CACHE_MS = 2500;
const MAX_ITEMS = 500;
const DONE_VISIBLE_MS = 5 * 60_000;

type ApiSession = {
  id: string;
  agent?: { model?: string; name?: string | null };
  created_at?: number;
  last_active_at?: number;
  status?: string;
  error?: string | null;
  metadata?: Record<string, string>;
  required_actions?: Array<{ type?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number } | null;
  spend_control?: { consumed?: number | null; limit?: number } | null;
};
type ApiItem = Record<string, any>;
type CursorPage<T> = { data?: T[]; has_more?: boolean; last_id?: string | null };
type DetailCache = { fetchedAt: number; lastActiveAt: number; rev: number; items: TimelineItem[]; turns: number };
export interface CreateCodexApiSessionRequest { title?: string; prompt: string; model?: string; effort?: string; maxSpendUsd?: number; repositoryUrl?: string; allowNetwork?: boolean }
export interface ApiOperationResult { ok: boolean; error?: string; id?: string }

function epoch(value: unknown, fallback = Date.now()): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? (n < 10_000_000_000 ? n * 1000 : n) : fallback;
}
function textContent(item: ApiItem): string {
  const parts = Array.isArray(item.content) ? item.content : [];
  return parts.map((part: ApiItem) => typeof part.text === 'string' ? part.text : '').filter(Boolean).join('\n');
}
function firstLine(value: string): string { return value.split(/\r?\n/, 1)[0].trim(); }
function toTimelineItem(sessionId: string, item: ApiItem, index: number, fallbackTs: number): TimelineItem | null {
  const type = String(item.type ?? 'item');
  const id = typeof item.id === 'string' && item.id ? item.id : `${type}-${index}`;
  const ts = epoch(item.created_at ?? item.updated_at, fallbackTs);
  let kind: TimelineItem['kind'] = 'tool';
  let category: TimelineItem['category'] = 'other';
  let title = type.replace(/[._]/g, ' ');
  let body = '';
  let status: TimelineItem['status'] = item.status === 'in_progress' ? 'running' : item.status === 'incomplete' || item.error ? 'fail' : 'ok';
  if (type === 'message') {
    kind = item.role === 'user' ? 'user' : 'assistant';
    title = item.role === 'user' ? 'You' : item.phase === 'final_answer' ? 'Final answer' : 'Assistant';
    body = textContent(item);
    if (!body) return null;
    status = 'ok';
  } else if (type === 'reasoning') {
    kind = 'system';
    title = 'Reasoning summary';
    body = typeof item.summary === 'string' ? item.summary : '';
    status = 'info';
  } else if (/command|shell/.test(type)) {
    category = 'shell';
    title = typeof item.command === 'string' ? item.command : item.command ? safeText(item.command, 300) : 'Command execution';
    body = [
      typeof item.cwd === 'string' ? `cwd: ${item.cwd}` : '',
      item.command ? `command: ${safeText(item.command, 3000)}` : '',
      item.aggregated_output ?? item.output ?? item.stdout ?? '',
      item.exit_code != null ? `exit code: ${item.exit_code}` : '',
      item.error?.message ?? item.error ?? '',
    ].filter(Boolean).map((part) => typeof part === 'string' ? part : safeText(part, 10000)).join('\n\n');
  } else if (/mcp|function/.test(type)) {
    category = 'task';
    title = item.name ?? item.server_label ?? type.replace(/[._]/g, ' ');
    body = [item.arguments ? safeText(item.arguments, 8000) : '', item.output ? safeText(item.output, 8000) : '', item.error?.message ?? item.error ?? ''].filter(Boolean).join('\n\n');
  } else if (/web_search|browser/.test(type)) {
    category = 'web';
    title = 'Web search';
    body = safeText(item, 10000);
  } else if (/computer_use/.test(type)) {
    category = 'other';
    title = typeof item.title === 'string' ? item.title : 'Computer use';
    body = safeText({ status: item.status, title: item.title }, 1000);
  } else {
    body = safeText(item.output ?? item.result ?? item.summary ?? item.error ?? item, 10000);
  }
  const cleanBody = truncate(redact(body), 20_000);
  return { id: `${sessionId}:${id}`, rev: 0, ts, kind, title: safeText(title, 300), body: cleanBody, status, category };
}

function safeRepositoryUrl(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const url = new URL(value.trim());
  if (url.protocol !== 'https:' || !['github.com', 'www.github.com'].includes(url.hostname.toLowerCase()) || url.username || url.password || url.search || url.hash) {
    throw new Error('Use a public GitHub repository URL (https://github.com/owner/repository).');
  }
  const parts = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  if (parts.length !== 2 || !parts.every((part) => /^[A-Za-z0-9_.-]+$/.test(part))) {
    throw new Error('Enter a GitHub repository URL in the form https://github.com/owner/repository.');
  }
  return `https://github.com/${parts[0]}/${parts[1].replace(/\.git$/i, '')}.git`;
}

function shellQuote(value: string): string { return `'${value.replace(/'/g, `'\\''`)}'`; }

/** OpenAI Agents API source. API keys stay in the main process and each session is independently managed by the API. */
export class OpenAIAgentsSource implements Source {
  private readonly keys: AgentsApiKeyStore;
  private sessions = new Map<string, ApiSession>();
  private details = new Map<string, DetailCache>();
  private stateSince = new Map<string, { state: AgentState; at: number }>();
  private onUpdate: (snapshot: Snapshot) => void = () => {};
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private lastJson = '';

  constructor(keys: AgentsApiKeyStore) { this.keys = keys; }

  info(): SourceInfo {
    // Agents API sessions are one part of the ChatGPT Codex provider, not a separate provider.
    return { mode: 'live', home: 'OpenAI Agents API', providers: [], providerKeys: [] };
  }

  async start(onUpdate: (snapshot: Snapshot) => void): Promise<void> {
    this.onUpdate = onUpdate;
    await this.tick();
    this.timer = setInterval(() => void this.tick(), POLL_MS);
  }

  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  async validateKey(key: string): Promise<ApiOperationResult> {
    const trimmed = key.trim();
    if (!/^sk-[A-Za-z0-9_-]{20,}$/.test(trimmed)) return { ok: false, error: 'That does not look like an OpenAI API key.' };
    try {
      await this.requestWithKey(trimmed, '/sessions?limit=1');
      this.keys.save(trimmed);
      void this.tick();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: safeText((error as Error).message, 400) };
    }
  }

  removeKey(): void { this.keys.remove(); this.sessions.clear(); this.details.clear(); this.publish(); }

  async createSession(input: CreateCodexApiSessionRequest): Promise<ApiOperationResult> {
    const prompt = typeof input?.prompt === 'string' ? input.prompt.trim() : '';
    const title = (typeof input?.title === 'string' ? input.title.trim().slice(0, 80) : '') || firstLine(prompt).slice(0, 80) || 'New Codex task';
    const model = (typeof input?.model === 'string' ? input.model.trim() : '') || 'gpt-6-astra';
    if (!prompt || prompt.length > 20_000) return { ok: false, error: 'Enter a task between 1 and 20,000 characters.' };
    if (!/^[A-Za-z0-9._:-]{1,100}$/.test(model)) return { ok: false, error: 'Enter a valid model name.' };
    const effort = typeof input?.effort === 'string' ? input.effort.trim() : '';
    if (effort && !['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(effort)) return { ok: false, error: 'Choose a supported reasoning effort.' };
    let repoUrl: string | undefined;
    try { repoUrl = safeRepositoryUrl(input.repositoryUrl); }
    catch (error) { return { ok: false, error: safeText((error as Error).message, 300) }; }
    const dollars = input.maxSpendUsd ?? 5;
    if (!Number.isFinite(dollars) || dollars < 0.01 || dollars > 100_000) return { ok: false, error: 'Set a per-session limit from $0.01 to $100,000.' };
    const key = this.keys.read();
    if (!key) return { ok: false, error: 'Add an OpenAI API key before starting a Codex task.' };
    const instructions = repoUrl
      ? `Work in the public GitHub repository cloned at /workspace/repo. Make focused changes that satisfy the user request, inspect your changes, and report what you changed. Do not claim tests or commands passed unless you actually ran them.`
      : 'Work in the hosted Codex workspace. Make focused changes that satisfy the user request, inspect your work, and report what you completed. Do not claim tests or commands passed unless you actually ran them.';
    const environment: Record<string, unknown> = { type: 'openai_hosted' };
    if (input.allowNetwork === true) environment.network = { access: 'enabled' };
    else environment.network = repoUrl
      ? { access: 'restricted', allowed_domains: ['github.com', 'api.github.com', 'objects.githubusercontent.com', 'codeload.github.com'] }
      : { access: 'disabled' };
    if (repoUrl) {
      environment.setup_commands = [{ command: `git clone --depth 1 -- ${shellQuote(repoUrl)} /workspace/repo`, cwd: '/workspace' }];
    }
    try {
      const session = await this.requestWithKey<ApiSession>(key, '/sessions', {
        method: 'POST',
        body: JSON.stringify({
          agent: { model, instructions, ...(effort ? { reasoning: { effort } } : {}) },
          environment,
          input: prompt,
          metadata: { ur_agents_title: title, ...(repoUrl ? { ur_agents_repository: repoUrl } : {}) },
          spend_control: { limit: Math.round(dollars * 100) },
        }),
      });
      if (session.id) {
        this.sessions.set(session.id, session);
        this.details.delete(session.id);
        this.publish();
        return { ok: true, id: `${SESSION_ID}${session.id}` };
      }
      return { ok: false, error: 'The API did not return a session ID.' };
    } catch (error) {
      return { ok: false, error: safeText((error as Error).message, 400) };
    }
  }

  async send(id: string, message: string): Promise<ApiOperationResult> {
    const sessionId = this.sessionId(id);
    const text = message.trim();
    if (!sessionId) return { ok: false, error: 'Invalid Codex API session ID.' };
    if (!text || text.length > 20_000) return { ok: false, error: 'Enter a message up to 20,000 characters.' };
    try {
      await this.request(`/sessions/${encodeURIComponent(sessionId)}/events`, {
        method: 'POST',
        body: JSON.stringify({ events: [{ type: 'agent.session.input.message', input: [{ role: 'user', content: [{ type: 'input_text', text }] }] }] }),
      });
      void this.tick();
      return { ok: true };
    } catch (error) { return { ok: false, error: safeText((error as Error).message, 400) }; }
  }

  async cancel(id: string): Promise<ApiOperationResult> {
    const sessionId = this.sessionId(id);
    if (!sessionId) return { ok: false, error: 'Invalid Codex API session ID.' };
    try {
      await this.request(`/sessions/${encodeURIComponent(sessionId)}/events`, {
        method: 'POST', body: JSON.stringify({ events: [{ type: 'agent.session.input.cancel' }] }),
      });
      void this.tick();
      return { ok: true };
    } catch (error) { return { ok: false, error: safeText((error as Error).message, 400) }; }
  }

  async detail(id: string, since: number): Promise<SessionDetail | null> {
    const sessionId = this.sessionId(id);
    const session = sessionId ? this.sessions.get(sessionId) : undefined;
    if (!sessionId || !session) return null;
    const lastActive = epoch(session.last_active_at, epoch(session.created_at));
    let cache = this.details.get(sessionId);
    if (!cache || cache.lastActiveAt !== lastActive || Date.now() - cache.fetchedAt >= DETAIL_CACHE_MS) {
      cache = await this.loadDetail(sessionId, lastActive);
      this.details.set(sessionId, cache);
    }
    return { id, rev: cache.rev, items: since <= 0 ? cache.items : cache.items.filter((item) => item.rev > since), source: 'OpenAI Agents API session history' };
  }

  private sessionId(id: string): string | null {
    const prefix = id.startsWith(SESSION_ID) ? SESSION_ID : id.startsWith('work:') ? 'work:' : null;
    if (!prefix) return null;
    const value = id.slice(prefix.length);
    return /^[A-Za-z0-9_-]{1,120}$/.test(value) ? value : null;
  }

  private async request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const key = this.keys.read();
    if (!key) throw new Error('OpenAI API key is missing. Select ChatGPT Codex and add your key.');
    return this.requestWithKey<T>(key, path, init);
  }

  private async requestWithKey<T = unknown>(key: string, path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${key}`, 'OpenAI-Beta': 'agents=v1', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
      signal: AbortSignal.timeout(30_000),
    });
    const raw = await response.text();
    let payload: any = {};
    try { payload = raw ? JSON.parse(raw) : {}; } catch { /* error below is normalized */ }
    if (!response.ok) {
      let message = `OpenAI Agents API returned HTTP ${response.status}.`;
      if (response.status === 401) message = 'The API key was rejected. Check that it is active.';
      else if (response.status === 403) message = 'The key needs api.agents.read, api.agents.write and api.responses.write permissions.';
      else if (response.status === 429) message = 'The API rate limit or project spending limit was reached.';
      else if (typeof payload?.error?.message === 'string') message = safeText(payload.error.message.replaceAll(key, '[redacted]'), 300);
      throw new Error(message);
    }
    return payload as T;
  }

  private async tick(): Promise<void> {
    if (this.busy || !this.keys.read()) { this.publish(); return; }
    this.busy = true;
    try {
      const all: ApiSession[] = [];
      let after = '';
      const seen = new Set<string>();
      for (let pageNo = 0; pageNo < 20; pageNo++) {
        const query = new URLSearchParams({ limit: '100', order: 'desc' });
        if (after) query.set('after', after);
        const page = await this.request<CursorPage<ApiSession>>(`/sessions?${query}`);
        all.push(...(page.data ?? []));
        if (!page.has_more || !page.last_id || seen.has(page.last_id)) break;
        seen.add(page.last_id);
        after = page.last_id;
      }
      this.sessions = new Map(all.filter((session) => session.id).map((session) => [session.id, session]));
      this.publish();
    } catch {
      // Keep the last good view during transient network or API errors.
      this.publish();
    } finally { this.busy = false; }
  }

  private async loadDetail(sessionId: string, lastActiveAt: number): Promise<DetailCache> {
    const old = this.details.get(sessionId);
    try {
      const all: ApiItem[] = [];
      let after = '';
      const seen = new Set<string>();
      for (let pageNo = 0; pageNo < 10 && all.length < MAX_ITEMS; pageNo++) {
        const query = new URLSearchParams({ limit: '100', order: 'asc' });
        if (after) query.set('after', after);
        const page = await this.request<CursorPage<ApiItem>>(`/sessions/${encodeURIComponent(sessionId)}/items?${query}`);
        all.push(...(page.data ?? []));
        if (!page.has_more || !page.last_id || seen.has(page.last_id)) break;
        seen.add(page.last_id);
        after = page.last_id;
      }
      const generated = all.slice(-MAX_ITEMS).map((item, index) => toTimelineItem(sessionId, item, index, lastActiveAt)).filter((item): item is TimelineItem => !!item);
      const previous = new Map((old?.items ?? []).map((item) => [item.id, item]));
      let rev = old?.rev ?? 0;
      const items = generated.map((item) => {
        const prior = previous.get(item.id);
        if (prior && JSON.stringify({ ...prior, rev: 0 }) === JSON.stringify({ ...item, rev: 0 })) return prior;
        return { ...item, rev: ++rev };
      });
      return { fetchedAt: Date.now(), lastActiveAt, rev, items, turns: new Set(all.map((item) => item.turn_id).filter(Boolean)).size };
    } catch (error) {
      const message = safeText((error as Error).message, 300);
      const item: TimelineItem = { id: `${sessionId}:history-error`, rev: (old?.rev ?? 0) + 1, ts: Date.now(), kind: 'system', title: 'History unavailable', body: message, status: 'warn' };
      return { fetchedAt: Date.now(), lastActiveAt, rev: item.rev, items: old?.items.length ? old.items : [item], turns: old?.turns ?? 0 };
    }
  }

  private runtime(session: ApiSession, now: number): { state: AgentState; live: boolean; activity: string } {
    const status = session.status;
    if (status === 'in_progress') return { state: 'thinking', live: true, activity: 'working in OpenAI hosted environment' };
    if (status === 'requires_action') {
      const approval = session.required_actions?.some((action) => /approval/.test(action.type ?? ''));
      return { state: approval ? 'awaiting-permission' : 'awaiting-input', live: true, activity: approval ? 'waiting for approval' : 'waiting for required action' };
    }
    if (status === 'failed') return { state: 'error', live: false, activity: safeText(session.error || 'session failed', 300) };
    if (status === 'idle') {
      const recent = now - epoch(session.last_active_at, epoch(session.created_at)) < DONE_VISIBLE_MS;
      return { state: recent && this.details.get(session.id)?.items.some((item) => item.kind === 'assistant') ? 'done' : 'idle', live: true, activity: 'waiting in ChatGPT Codex' };
    }
    return { state: 'offline', live: false, activity: status || 'saved in ChatGPT Codex' };
  }

  private publish(): void {
    const now = Date.now();
    const room: RoomInfo = { id: ROOM_ID, name: 'Codex API tasks', kind: 'chats', provider: 'codex', canLaunch: true };
    const sessions: SessionSummary[] = [...this.sessions.values()].map((session) => {
      const id = `${SESSION_ID}${session.id}`;
      const model = session.agent?.model || 'OpenAI agent';
      const runtime = this.runtime(session, now);
      const previous = this.stateSince.get(id);
      const stateSince = previous?.state === runtime.state ? previous.at : now;
      this.stateSince.set(id, { state: runtime.state, at: stateSince });
      const cache = this.details.get(session.id);
      const repo = session.metadata?.ur_agents_repository;
      const project = repo ? repo.split('/').at(-1)?.replace(/\.git$/i, '') : undefined;
      const title = safeText(session.metadata?.ur_agents_title?.trim() || session.agent?.name || `${model} · ${new Date(epoch(session.created_at)).toLocaleString()}`, 100);
      const latest = cache?.items.at(-1);
      const feed: FeedItem[] = (cache?.items.slice(-9) ?? []).map((item) => ({ ts: item.ts, kind: item.kind, category: item.category, status: item.status, title: item.title, text: firstLine(item.body ?? item.title) }));
      const focusItem = cache?.items.slice().reverse().find((item) => item.kind === 'tool' && item.status === 'running') ?? latest;
      return {
        id, provider: 'codex' as const, room: ROOM_ID, title, project, model, family: familyOf(model), tier: tierOf(model),
        mode: session.agent?.name || undefined, state: runtime.state, stateSince,
        activity: runtime.activity || (latest ? firstLine(latest.body ?? latest.title) : 'Open the session to view its history.'),
        live: runtime.live, lastEventAt: epoch(session.last_active_at, epoch(session.created_at)),
        contextTokens: session.usage?.input_tokens, toolCalls: cache?.items.filter((item) => item.kind === 'tool').length ?? 0,
        costUsd: session.spend_control?.consumed != null ? session.spend_control.consumed / 100 : undefined,
        costUsdLimit: session.spend_control?.limit != null ? session.spend_control.limit / 100 : undefined,
        turns: cache?.turns ?? 0, hooks: 0, subagents: [], feed,
        focus: focusItem ? { kind: focusItem.kind, category: focusItem.category, status: focusItem.status, title: focusItem.title, text: truncate(focusItem.body ?? '', 1100), ts: focusItem.ts } : undefined,
        hasEvents: !!cache?.items.length,
      };
    }).sort((a, b) => b.lastEventAt - a.lastEventAt);
    const json = JSON.stringify({ rooms: [room], sessions });
    if (json === this.lastJson) return;
    this.lastJson = json;
    this.onUpdate({ rooms: [room], sessions });
  }
}
