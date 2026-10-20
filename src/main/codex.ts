import { createHash } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { familyOf, tierOf } from '../core/family.ts';
import { redact, safeText, truncate } from '../core/redact.ts';
import type { AgentState, FeedItem, FocusInfo, RoomInfo, SessionDetail, SessionSummary, Snapshot, SubAgentInfo, TimelineItem, ToolCategory } from '../core/types.ts';
import type { Source, SourceInfo } from './source.ts';

const POLL_MS = 2500;
const REPAIR_SCAN_MS = 30_000;
const DETAIL_CACHE_MS = 2500;
const MAX_TURNS = 24;
const MAX_ITEMS = 500;
const DONE_VISIBLE_MS = 5 * 60_000;
const SOURCE_KINDS = ['cli', 'vscode', 'exec', 'appServer', 'subAgent', 'subAgentReview', 'subAgentCompact', 'subAgentThreadSpawn', 'subAgentOther', 'unknown'];
const CODEX_ID = 'codex:';
const CODEX_ALL_ROOM = 'codex:all';

type RpcError = { code?: number; message?: string };
type RpcMessage = { id?: number; result?: unknown; error?: RpcError; method?: string; params?: unknown };

interface CodexThread {
  id: string;
  name?: string | null;
  preview?: string | null;
  cwd?: string | null;
  model?: string | null;
  modelProvider?: string | null;
  reasoningEffort?: string | null;
  createdAt?: number | string | null;
  updatedAt?: number | string | null;
  recencyAt?: number | string | null;
  status?: { type?: string; activeFlags?: unknown };
  source?: string | null;
  parentThreadId?: string | null;
  threadSource?: string | null;
  agentNickname?: string | null;
  agentRole?: string | null;
  gitInfo?: { branch?: string | null; headBranch?: string | null } | null;
  ephemeral?: boolean;
  turns?: CodexTurn[];
}

interface CodexTurn {
  id: string;
  status?: string;
  startedAt?: number | string | null;
  completedAt?: number | string | null;
  items?: CodexItem[];
}

interface CodexItem {
  id?: string;
  type?: string;
  status?: string;
  [key: string]: unknown;
}

interface TurnPage {
  data?: CodexTurn[];
  nextCursor?: string | null;
}

interface ThreadPage {
  data?: CodexThread[];
  nextCursor?: string | null;
}

interface DetailCache {
  fetchedAt: number;
  threadUpdatedAt: number;
  rev: number;
  items: TimelineItem[];
  latestTurnStatus?: string;
  latestCompletedAt?: number;
  turns: number;
}

function versionSort(a: string, b: string): number {
  const aa = a.split(/[.-]/).map((v) => Number.parseInt(v, 10) || 0);
  const bb = b.split(/[.-]/).map((v) => Number.parseInt(v, 10) || 0);
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) if ((aa[i] ?? 0) !== (bb[i] ?? 0)) return (bb[i] ?? 0) - (aa[i] ?? 0);
  return 0;
}

/** Finds the official Codex CLI bundled with the ChatGPT desktop app. */
export function findCodexCli(): string {
  const explicit = process.env.UR_AGENTS_CODEX || process.env.CODEX_CLI_PATH;
  if (explicit && fs.existsSync(explicit)) return explicit;
  const exe = process.platform === 'win32' ? 'codex.exe' : 'codex';
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const root = path.join(local, 'OpenAI', 'Codex', 'bin');
  try {
    const versions = fs.readdirSync(root).filter((v) => fs.existsSync(path.join(root, v, exe)));
    versions.sort((a, b) => {
      const semver = versionSort(a, b);
      if (semver) return semver;
      return fs.statSync(path.join(root, b)).mtimeMs - fs.statSync(path.join(root, a)).mtimeMs;
    });
    if (versions.length) return path.join(root, versions[0], exe);
  } catch {
    /* try PATH below */
  }
  return process.platform === 'win32' ? 'codex.exe' : 'codex';
}

/** JSON-RPC over the supported app-server stdio transport. */
class AppServerClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private nextId = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private connecting: Promise<void> | null = null;
  connected = false;

  async connect(): Promise<void> {
    if (this.connected) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.open();
    try {
      await this.connecting;
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      this.connecting = null;
    }
  }

  private async open(): Promise<void> {
    const env = { ...process.env };
    for (const key of ['CODEX_THREAD_ID', 'CODEX_SESSION_ID', 'CODEX_TOOL_CALL_ID', 'CODEX_INTERNAL_ORIGINATOR_OVERRIDE', 'CODEX_TASK_WORKSPACE_VERIFYING_IDENTITY', 'CODEX_PERMISSION_PROFILE']) delete env[key];
    const child = spawn(findCodexCli(), ['app-server', '--listen', 'stdio://'], {
      cwd: os.homedir(),
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child = child;
    this.buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.read(chunk));
    child.stderr.resume();
    child.on('error', (error) => { if (this.child === child) this.fail(error); });
    child.on('exit', (code, signal) => { if (this.child === child) this.fail(new Error(`Codex App Server exited (${code ?? signal ?? 'unknown'}).`)); });

    await this.request('initialize', {
      clientInfo: { name: 'ur_agents', title: 'ur-agents', version: '0.2.0' },
      capabilities: { experimentalApi: true },
    });
    this.notify('initialized', {});
    this.connected = true;
  }

  request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const child = this.child;
    if (!child || child.killed || child.stdin.destroyed) return Promise.reject(new Error('Codex App Server is not connected.'));
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex App Server request timed out (${method}).`));
      }, method === 'thread/list' && params.useStateDbOnly === false ? 60_000 : 12_000);
      this.pending.set(id, { resolve: (v) => resolve(v as T), reject, timer });
      try {
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  notify(method: string, params: Record<string, unknown>): void {
    if (!this.child || this.child.killed || this.child.stdin.destroyed) return;
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  close(): void {
    const child = this.child;
    this.child = null;
    this.connected = false;
    if (child && !child.killed) child.kill();
    this.fail(new Error('Codex App Server stopped.'));
  }

  private read(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const end = this.buffer.indexOf('\n');
      if (end < 0) return;
      const line = this.buffer.slice(0, end).trim();
      this.buffer = this.buffer.slice(end + 1);
      if (!line) continue;
      let msg: RpcMessage;
      try {
        msg = JSON.parse(line) as RpcMessage;
      } catch {
        continue;
      }
      if (typeof msg.id !== 'number') continue;
      const pending = this.pending.get(msg.id);
      if (!pending) continue;
      clearTimeout(pending.timer);
      this.pending.delete(msg.id);
      if (msg.error) pending.reject(new Error(msg.error.message || `Codex App Server error ${msg.error.code ?? ''}`));
      else pending.resolve(msg.result);
    }
  }

  private fail(error: Error): void {
    this.connected = false;
    const child = this.child;
    this.child = null;
    if (child && !child.killed) child.kill();
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.pending.clear();
  }
}

function timestamp(value: number | string | null | undefined, fallback = 0): number {
  if (typeof value === 'number') return value < 10_000_000_000 ? value * 1000 : value;
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n)) return n < 10_000_000_000 ? n * 1000 : n;
    const date = Date.parse(value);
    if (!Number.isNaN(date)) return date;
  }
  return fallback;
}

function firstLine(value?: string): string {
  return (value ?? '').split('\n').find((line) => line.trim())?.trim().slice(0, 130) ?? '';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map((part) => {
    const item = asRecord(part);
    if (typeof item.text === 'string') return item.text;
    if (typeof item.content === 'string') return item.content;
    return '';
  }).filter(Boolean).join('\n');
}

function itemStatus(item: CodexItem): TimelineItem['status'] {
  const status = String(item.status ?? '').toLowerCase();
  if (/progress|running|pending/.test(status)) return 'running';
  if (/fail|error|reject|interrupt/.test(status)) return 'fail';
  if (/complete|success|done/.test(status)) return Number(item.exitCode ?? 0) === 0 ? 'ok' : 'fail';
  return 'info';
}

function categoryFor(type: string): ToolCategory {
  if (/command|shell|terminal|process/.test(type)) return 'shell';
  if (/file|edit|patch/.test(type)) return 'write';
  if (/web|search|browser/.test(type)) return 'web';
  if (/agent|spawn|collab/.test(type)) return 'task';
  if (/mcp/.test(type)) return 'other';
  return 'other';
}

function mapItem(threadId: string, turn: CodexTurn, raw: CodexItem, index: number, ts: number): TimelineItem | null {
  const type = String(raw.type ?? '');
  if (!type || /reasoning|tokenUsage|citation|imageView/.test(type)) return null;
  const id = `codex:${threadId}:${turn.id}:${String(raw.id ?? index)}`;
  if (type === 'userMessage') {
    const body = safeText(textOf(raw.content), 3000);
    return { id, rev: 0, ts, kind: 'user', title: 'Prompt', body, status: 'info' };
  }
  if (type === 'agentMessage') {
    const body = safeText(String(raw.text ?? ''), 4000);
    return body.trim() ? { id, rev: 0, ts, kind: 'assistant', title: 'Codex', body, status: 'info' } : null;
  }
  if (type === 'commandExecution') {
    const command = String(raw.command ?? 'Command');
    const output = String(raw.aggregatedOutput ?? '');
    const body = safeText([command, output].filter(Boolean).join('\n\n'), 4000);
    return { id, rev: 0, ts, kind: 'tool', title: 'Terminal', body, status: itemStatus(raw), category: 'shell', durationMs: Number(raw.durationMs) || undefined };
  }
  if (type === 'fileChange') {
    const changes = Array.isArray(raw.changes) ? raw.changes : [];
    const body = safeText(changes.map((change) => {
      const entry = asRecord(change);
      return [entry.path, entry.diff].filter((part) => typeof part === 'string').join('\n');
    }).join('\n\n'), 4000);
    return { id, rev: 0, ts, kind: 'tool', title: 'File changes', body, status: itemStatus(raw), category: 'write' };
  }
  if (/^webSearch$/.test(type)) {
    const body = safeText(String(raw.query ?? ''), 1200);
    return { id, rev: 0, ts, kind: 'tool', title: 'Web search', body, status: itemStatus(raw), category: 'web' };
  }
  if (/^(enteredReviewMode|exitedReviewMode|contextCompaction|systemNotification)$/.test(type)) {
    const body = safeText(String(raw.message ?? raw.summary ?? ''), 1200);
    const title = type === 'enteredReviewMode' ? 'Review started' : type === 'exitedReviewMode' ? 'Review finished' : type === 'contextCompaction' ? 'Context compacted' : 'Codex notice';
    return { id, rev: 0, ts, kind: 'system', title, body, status: 'info' };
  }

  const title = type === 'mcpToolCall'
    ? `${String(raw.server ?? 'MCP')}.${String(raw.tool ?? 'tool')}`
    : String(raw.name ?? raw.toolName ?? type.replace(/([a-z])([A-Z])/g, '$1 $2'));
  const bodyParts = [raw.command, raw.arguments, raw.input, raw.output, raw.result, raw.error]
    .filter((part) => typeof part === 'string' || (part && typeof part === 'object'))
    .map((part) => typeof part === 'string' ? part : JSON.stringify(part));
  const body = safeText(bodyParts.join('\n\n'), 3000);
  const kind = /agent|spawn|collab/i.test(type) ? 'subagent' : 'tool';
  return { id, rev: 0, ts, kind, title: safeText(title, 180), body, status: itemStatus(raw), category: categoryFor(type) };
}

function pathRoom(cwd: string | null | undefined): { id: string; name: string; kind: RoomInfo['kind'] } {
  if (!cwd) return { id: 'codex:other', name: 'ChatGPT · Other', kind: 'other' };
  const normalized = path.resolve(cwd).toLocaleLowerCase();
  const hash = createHash('sha1').update(normalized).digest('hex').slice(0, 12);
  return { id: `codex:project:${hash}`, name: path.basename(cwd) || cwd, kind: 'project' };
}

function runtimeState(thread: CodexThread, detail: DetailCache | undefined, now: number): { state: AgentState; activity: string; category?: ToolCategory; live: boolean } {
  const status = String(thread.status?.type ?? 'notLoaded');
  const flags = JSON.stringify(thread.status?.activeFlags ?? '').toLowerCase();
  const latest = detail?.items[detail.items.length - 1];
  const runningTool = detail?.items.slice().reverse().find((item) => item.kind === 'tool' && item.status === 'running');
  if (status === 'systemError') return { state: 'error', activity: 'Codex reported an error', live: false };
  if (status === 'active' || detail?.latestTurnStatus === 'inProgress') {
    if (/approval|permission/.test(flags)) return { state: 'awaiting-permission', activity: 'waiting for permission', live: true };
    if (/userinput|user_input|question/.test(flags)) return { state: 'awaiting-input', activity: 'waiting for your answer', live: true };
    if (runningTool) return { state: 'tool', activity: firstLine(runningTool.body) || runningTool.title, category: runningTool.category, live: true };
    return { state: 'thinking', activity: latest?.kind === 'assistant' ? firstLine(latest.body) : 'working in Codex', live: true };
  }
  if (status === 'idle') return { state: 'idle', activity: 'waiting in Codex', live: true };
  if (detail?.latestTurnStatus === 'failed') return { state: 'error', activity: 'last Codex turn failed', live: false };
  if (detail?.latestTurnStatus === 'completed' && detail.latestCompletedAt && now - detail.latestCompletedAt < DONE_VISIBLE_MS) return { state: 'done', activity: 'task complete', live: false };
  return { state: 'offline', activity: latest?.kind === 'assistant' ? firstLine(latest.body) : 'saved in Codex', live: false };
}

/** Read-only local ChatGPT/Codex sessions through the documented Codex App Server API. */
export class CodexSource implements Source {
  private client = new AppServerClient();
  private threads = new Map<string, CodexThread>();
  private details = new Map<string, DetailCache>();
  private stateSince = new Map<string, { state: AgentState; at: number }>();
  private lastRepairScanAt = 0;
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private onUpdate: (snapshot: Snapshot) => void = () => {};
  private lastJson = '';

  info(): SourceInfo {
    return { mode: 'live', home: process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), providers: ['ChatGPT (Codex App Server)'], providerKeys: ['codex'] };
  }

  async start(onUpdate: (snapshot: Snapshot) => void): Promise<void> {
    this.onUpdate = onUpdate;
    await this.tick();
    this.timer = setInterval(() => void this.tick(), POLL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.client.close();
  }

  async detail(id: string, since: number): Promise<SessionDetail | null> {
    const threadId = id.startsWith(CODEX_ID) ? id.slice(CODEX_ID.length) : '';
    const thread = this.threads.get(threadId);
    if (!thread) return null;
    let cache = this.details.get(threadId);
    const updatedAt = timestamp(thread.updatedAt, timestamp(thread.createdAt));
    if (!cache || cache.threadUpdatedAt !== updatedAt || Date.now() - cache.fetchedAt >= DETAIL_CACHE_MS) {
      cache = await this.loadDetail(thread);
      this.details.set(threadId, cache);
      this.publish(Date.now());
    }
    return { id, rev: cache.rev, items: since <= 0 ? cache.items : cache.items.filter((item) => item.rev > since), source: 'Codex App Server history' };
  }

  private async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.client.connect();
      const all: CodexThread[] = [];
      let cursor: string | undefined;
      const cursors = new Set<string>();
      const now = Date.now();
      const scanRepair = now - this.lastRepairScanAt >= REPAIR_SCAN_MS;
      if (scanRepair) this.lastRepairScanAt = now;
      while (true) {
        const result = await this.client.request<ThreadPage>('thread/list', {
          cursor,
          limit: 100,
          sortKey: 'recency_at',
          sortDirection: 'desc',
          sourceKinds: SOURCE_KINDS,
          archived: false,
          // Periodic scan/repair finds named Worktree threads omitted from the fast state-DB path.
          useStateDbOnly: !scanRepair,
        });
        all.push(...(result.data ?? []));
        const nextCursor = result.nextCursor;
        if (!nextCursor || !result.data?.length || cursors.has(nextCursor)) break;
        cursors.add(nextCursor);
        cursor = nextCursor;
      }
      const available = all.filter((thread) => !!thread.id).sort((a, b) => {
        const active = Number(b.status?.type === 'active') - Number(a.status?.type === 'active');
        return active || timestamp(b.recencyAt ?? b.updatedAt ?? b.createdAt) - timestamp(a.recencyAt ?? a.updatedAt ?? a.createdAt);
      });
      if (scanRepair) {
        this.threads = new Map(available.map((thread) => [thread.id, thread]));
      } else {
        const refreshed = new Map(available.map((thread) => [thread.id, thread]));
        for (const thread of this.threads.values()) if (!refreshed.has(thread.id)) refreshed.set(thread.id, thread);
        this.threads = new Map([...refreshed.values()].sort((a, b) => {
          const active = Number(b.status?.type === 'active') - Number(a.status?.type === 'active');
          return active || timestamp(b.recencyAt ?? b.updatedAt ?? b.createdAt) - timestamp(a.recencyAt ?? a.updatedAt ?? a.createdAt);
        }).map((thread) => [thread.id, thread]));
      }
      this.publish(Date.now());
    } catch (error) {
      // Keep the last good view while the bundled CLI restarts or the local server is unavailable.
    } finally {
      this.busy = false;
    }
  }

  private async loadDetail(thread: CodexThread): Promise<DetailCache> {
    const old = this.details.get(thread.id);
    const updatedAt = timestamp(thread.updatedAt, timestamp(thread.createdAt));
    try {
      const result = await this.client.request<TurnPage>('thread/turns/list', {
        threadId: thread.id,
        limit: MAX_TURNS,
        sortDirection: 'desc',
        itemsView: 'full',
      });
      const turns = (result.data ?? []).slice().reverse();
      const generated: TimelineItem[] = [];
      for (const turn of turns) {
        const baseTs = timestamp(turn.startedAt, updatedAt);
        for (const [index, item] of (turn.items ?? []).entries()) {
          const mapped = mapItem(thread.id, turn, item, index, baseTs + index);
          if (mapped) generated.push(mapped);
        }
      }
      const limited = generated.slice(-MAX_ITEMS);
      const previous = new Map((old?.items ?? []).map((item) => [item.id, item]));
      let rev = old?.rev ?? 0;
      const items = limited.map((item) => {
        const prior = previous.get(item.id);
        const comparable = { ...item, rev: 0 };
        const priorComparable = prior ? { ...prior, rev: 0 } : null;
        if (prior && JSON.stringify(comparable) === JSON.stringify(priorComparable)) return prior;
        return { ...item, rev: ++rev };
      });
      const latestTurn = turns.at(-1);
      return {
        fetchedAt: Date.now(),
        threadUpdatedAt: updatedAt,
        rev,
        items,
        latestTurnStatus: latestTurn?.status,
        latestCompletedAt: timestamp(latestTurn?.completedAt, 0),
        turns: turns.length,
      };
    } catch (error) {
      const text = safeText(error instanceof Error ? error.message : String(error), 300);
      const item: TimelineItem = {
        id: `codex:${thread.id}:history-error`,
        rev: (old?.rev ?? 0) + 1,
        ts: Date.now(),
        kind: 'system',
        title: 'History unavailable',
        body: text,
        status: 'warn',
      };
      return { fetchedAt: Date.now(), threadUpdatedAt: updatedAt, rev: item.rev, items: [item], latestTurnStatus: old?.latestTurnStatus, latestCompletedAt: old?.latestCompletedAt, turns: old?.turns ?? 0 };
    }
  }

  private publish(now: number): void {
    const rows = [...this.threads.values()];
    const byId = new Map(rows.map((thread) => [thread.id, thread]));
    const children = new Map<string, CodexThread[]>();
    for (const thread of rows) {
      const parent = thread.parentThreadId;
      if (parent && byId.has(parent)) {
        const list = children.get(parent) ?? [];
        list.push(thread);
        children.set(parent, list);
      }
    }
    const rooms = new Map<string, RoomInfo>();
    rooms.set(CODEX_ALL_ROOM, { id: CODEX_ALL_ROOM, name: 'All Codex threads', kind: 'chats', provider: 'codex', canLaunch: false });
    const sessions: SessionSummary[] = [];
    for (const thread of rows) {
      const room = pathRoom(thread.cwd);
      rooms.set(room.id, { ...room, provider: 'codex', canLaunch: false });
      const id = `${CODEX_ID}${thread.id}`;
      const cache = this.details.get(thread.id);
      const runtime = runtimeState(thread, cache, now);
      const priorState = this.stateSince.get(id);
      const stateSince = priorState?.state === runtime.state ? priorState.at : (priorState ? now : (cache?.items[0]?.ts ?? timestamp(thread.updatedAt ?? thread.createdAt, now)));
      this.stateSince.set(id, { state: runtime.state, at: stateSince });
      const model = thread.model || thread.modelProvider || 'Codex';
      const project = thread.cwd ? path.basename(thread.cwd) : undefined;
      const subagents = (children.get(thread.id) ?? []).map((child): SubAgentInfo => {
        const childModel = child.model || child.modelProvider || model;
        return {
          agentId: child.id,
          name: child.agentRole || child.agentNickname || child.name || 'sub-agent',
          displayName: child.agentNickname || child.agentRole || child.name || 'sub-agent',
          model: childModel,
          family: familyOf(childModel),
          tier: tierOf(childModel),
          background: true,
          startedAt: timestamp(child.createdAt, now),
          status: child.status?.type === 'active' ? 'running' : child.status?.type === 'systemError' ? 'failed' : 'done',
        };
      });
      const latest = cache?.items.at(-1);
      const feed: FeedItem[] = (cache?.items.slice(-9) ?? []).map((item) => ({ ts: item.ts, kind: item.kind, category: item.category, status: item.status, title: item.title, text: firstLine(item.body ?? item.title) }));
      const focusItem = cache?.items.slice().reverse().find((item) => item.kind === 'tool' && item.status === 'running') ?? cache?.items.slice().reverse().find((item) => item.kind === 'tool' || item.kind === 'assistant' || item.kind === 'subagent');
      const focus: FocusInfo | undefined = focusItem ? { kind: focusItem.kind, category: focusItem.category, status: focusItem.status, title: focusItem.title, text: truncate(focusItem.body ?? '', 1100), ts: focusItem.ts } : undefined;
      const title = redact(thread.name?.trim() || firstLine(thread.preview || '') || project || thread.id.slice(0, 8));
      const summary: SessionSummary = {
        id,
        provider: 'codex',
        room: room.id,
        title,
        project,
        branch: thread.gitInfo?.branch || thread.gitInfo?.headBranch || undefined,
        model,
        family: familyOf(model),
        tier: tierOf(model),
        mode: thread.reasoningEffort || undefined,
        state: runtime.state,
        stateSince,
        activity: runtime.activity || (latest ? firstLine(latest.body) : 'saved in Codex'),
        category: runtime.category,
        live: runtime.live,
        lastEventAt: timestamp(thread.updatedAt ?? thread.recencyAt ?? thread.createdAt, 0),
        toolCalls: cache?.items.filter((item) => item.kind === 'tool').length ?? 0,
        turns: cache?.turns ?? thread.turns?.length ?? 0,
        hooks: 0,
        subagents,
        feed,
        focus,
        hasEvents: !!cache?.items.length,
      };
      sessions.push(summary);
    }
    const snapshot: Snapshot = { rooms: [...rooms.values()], sessions };
    const json = JSON.stringify(snapshot);
    if (json !== this.lastJson) {
      this.lastJson = json;
      this.onUpdate(snapshot);
    }
  }
}

/** Combines provider sources without changing their provider-specific storage or controls. */
export class CombinedSource implements Source {
  private copilot: Source;
  private codex: Source;
  private work?: Source;
  private copilotSnapshot: Snapshot = { rooms: [], sessions: [] };
  private codexSnapshot: Snapshot = { rooms: [], sessions: [] };
  private workSnapshot: Snapshot = { rooms: [], sessions: [] };
  private onUpdate: (snapshot: Snapshot) => void = () => {};
  private lastJson = '';

  constructor(copilot: Source, codex: Source, work?: Source) {
    this.copilot = copilot;
    this.codex = codex;
    this.work = work;
  }

  info(): SourceInfo {
    const copilot = this.copilot.info();
    const codex = this.codex.info();
    const work = this.work?.info();
    return {
      mode: copilot.mode,
      home: copilot.home,
      providers: [...(copilot.providers ?? ['GitHub Copilot']), ...(codex.providers ?? ['ChatGPT (Codex App Server)']), ...(work?.providers ?? [])],
      providerKeys: [...new Set([...(copilot.providerKeys ?? ['copilot']), ...(codex.providerKeys ?? ['codex']), ...(work?.providerKeys ?? [])])],
    };
  }

  async start(onUpdate: (snapshot: Snapshot) => void): Promise<void> {
    this.onUpdate = onUpdate;
    await Promise.all([
      this.copilot.start((snapshot) => { this.copilotSnapshot = snapshot; this.publish(); }),
      this.codex.start((snapshot) => { this.codexSnapshot = snapshot; this.publish(); }),
      ...(this.work ? [this.work.start((snapshot) => { this.workSnapshot = snapshot; this.publish(); })] : []),
    ]);
    this.publish();
  }

  stop(): void {
    this.copilot.stop();
    this.codex.stop();
    this.work?.stop();
  }

  async detail(id: string, since: number): Promise<SessionDetail | null> {
    if (id.startsWith('work:')) return this.work?.detail(id, since) ?? null;
    return id.startsWith(CODEX_ID) ? this.codex.detail(id, since) : this.copilot.detail(id, since);
  }

  private publish(): void {
    const snapshot: Snapshot = {
      rooms: [...this.copilotSnapshot.rooms, ...this.codexSnapshot.rooms, ...this.workSnapshot.rooms],
      sessions: [...this.copilotSnapshot.sessions, ...this.codexSnapshot.sessions, ...this.workSnapshot.sessions],
    };
    const json = JSON.stringify(snapshot);
    if (json === this.lastJson) return;
    this.lastJson = json;
    this.onUpdate(snapshot);
  }
}
