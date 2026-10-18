import type { AgentState, RawEvent, SessionSummary, SubAgentInfo, TimelineItem, ToolCategory } from './types.ts';
import { familyOf, tierOf } from './family.ts';
import { categoryOf, summarizePermission, summarizeTool } from './summarize.ts';
import { safeText } from './redact.ts';

const MAX_ITEMS = 500;
const STALE_MS = 20 * 60_000;
const COMPACTION_MAX_MS = 10 * 60_000;
const ERROR_VISIBLE_MS = 10 * 60_000;
const DONE_VISIBLE_MS = 5 * 60_000;

interface RunningTool {
  name: string;
  label: string;
  category: ToolCategory;
  start: number;
}

interface AgentRuntime {
  turns: Set<string>;
  tools: Map<string, RunningTool>;
}

export interface TrackerContext {
  /** A live CLI process holds the session. */
  live: boolean;
  /** The app reports the session as busy. */
  running: boolean;
}

export type TrackerSnapshot = Pick<
  SessionSummary,
  | 'state'
  | 'stateSince'
  | 'activity'
  | 'category'
  | 'model'
  | 'mode'
  | 'lastEventAt'
  | 'costAiu'
  | 'premiumRequests'
  | 'toolCalls'
  | 'turns'
  | 'hooks'
  | 'subagents'
  | 'pending'
>;

function first<T>(it: Iterable<T>): T | undefined {
  for (const v of it) return v;
  return undefined;
}

/** Folds a stream of Copilot CLI session events into the live state of one agent. */
export class SessionTracker {
  rev = 0;
  model = '';
  mode?: string;
  hooks = 0;
  toolCalls = 0;
  turns = 0;
  lastEventAt = 0;

  private agents = new Map<string, AgentRuntime>();
  private permissions = new Map<string, { kind: string; text: string; ts: number }>();
  private question?: { text: string; callId: string };
  private compactionStart: number | null = null;
  private lastError?: { ts: number; message: string };
  private lastTaskCompleteTs = 0;
  private lastUserTs = 0;
  private shutdown = false;
  private usage?: { nanoAiu: number; premium: number };
  private subagents = new Map<string, SubAgentInfo>();
  private items: TimelineItem[] = [];
  private byId = new Map<string, TimelineItem>();
  private lastState: AgentState | null = null;
  private stateSince = 0;

  readonly id: string;

  constructor(id: string) {
    this.id = id;
  }

  countHook(): void {
    this.hooks++;
  }

  ingest(ev: RawEvent): void {
    const ts = ev.timestamp ? Date.parse(ev.timestamp) : Date.now();
    if (!Number.isNaN(ts) && ts > this.lastEventAt) this.lastEventAt = ts;
    const d = ev.data ?? {};
    const key = ev.agentId ?? 'main';

    switch (ev.type) {
      case 'session.start':
        if (d.selectedModel) this.model = String(d.selectedModel);
        this.shutdown = false;
        break;
      case 'session.resume':
        if (d.selectedModel) this.model = String(d.selectedModel);
        this.shutdown = false;
        this.resetRuntime();
        break;
      case 'session.shutdown':
        this.shutdown = true;
        this.resetRuntime();
        if (d.totalNanoAiu != null) this.usage = { nanoAiu: Number(d.totalNanoAiu), premium: Number(d.totalPremiumRequests ?? 0) };
        this.push(ev, ts, { kind: 'system', title: `Session closed (${d.shutdownType ?? 'normal'})`, status: 'info' });
        break;
      case 'session.model_change':
        if (d.newModel) this.model = String(d.newModel);
        this.push(ev, ts, { kind: 'system', title: `Model → ${d.newModel}`, status: 'info' });
        break;
      case 'session.mode_changed':
        this.mode = d.newMode;
        this.push(ev, ts, { kind: 'system', title: `Mode → ${d.newMode}`, status: 'info' });
        break;
      case 'user.message':
        this.lastUserTs = ts;
        this.push(ev, ts, { kind: 'user', title: 'Prompt', body: safeText(d.content, 1500) });
        break;
      case 'assistant.turn_start':
        this.agent(key).turns.add(String(d.turnId ?? ts));
        if (key === 'main') this.turns++;
        break;
      case 'assistant.turn_end':
        this.agent(key).turns.delete(String(d.turnId ?? ''));
        break;
      case 'assistant.message': {
        if (!this.model && d.model) this.model = String(d.model);
        const content = typeof d.content === 'string' ? d.content : '';
        if (content.trim()) {
          this.push(ev, ts, { kind: 'assistant', title: key === 'main' ? 'Agent' : 'Sub-agent', body: safeText(content, 3000) });
        }
        break;
      }
      case 'tool.execution_start':
        this.toolStart(ev, ts, key);
        break;
      case 'tool.execution_complete':
        this.toolComplete(ev, ts, key);
        break;
      case 'permission.requested': {
        const s = summarizePermission(d.permissionRequest);
        const rid = String(d.requestId ?? ev.id);
        this.permissions.set(rid, { ...s, ts });
        this.push(ev, ts, { kind: 'permission', title: `Permission: ${s.kind}`, body: s.text, status: 'pending' }, `p:${rid}`);
        break;
      }
      case 'permission.completed': {
        const rid = String(d.requestId ?? '');
        this.permissions.delete(rid);
        const it = this.byId.get(`p:${rid}`);
        if (it) {
          const verdict = String(d.result?.kind ?? 'resolved');
          it.title = `${it.title} → ${verdict}`;
          it.status = /reject|den/i.test(verdict) ? 'fail' : /approve|allow/i.test(verdict) ? 'ok' : 'info';
          this.touch(it);
        }
        break;
      }
      case 'session.compaction_start':
        this.compactionStart = ts;
        break;
      case 'session.compaction_complete':
        this.compactionStart = null;
        this.push(ev, ts, {
          kind: 'system',
          title: 'Context compacted',
          body: d.preCompactionTokens ? `${d.preCompactionTokens} → ${d.postCompactionTokens ?? '?'} tokens` : undefined,
          status: d.success === false ? 'warn' : 'info',
        });
        break;
      case 'session.error':
        this.lastError = { ts, message: safeText(d.message, 300) };
        this.push(ev, ts, { kind: 'system', title: 'Error', body: safeText(d.message, 800), status: 'fail' });
        break;
      case 'abort':
        if (key === 'main') this.resetRuntime();
        else this.agents.delete(key);
        this.push(ev, ts, { kind: 'system', title: `Stopped (${d.reason ?? 'abort'})`, status: 'warn' });
        break;
      case 'session.task_complete':
        this.lastTaskCompleteTs = ts;
        this.push(ev, ts, { kind: 'system', title: 'Task complete', body: safeText(d.summary, 800), status: 'ok' });
        break;
      case 'subagent.started':
        this.subagentStarted(ev, ts);
        break;
      case 'subagent.completed':
      case 'subagent.failed':
        this.subagentEnded(ev, ts);
        break;
      case 'session.usage_checkpoint':
        if (d.totalNanoAiu != null) this.usage = { nanoAiu: Number(d.totalNanoAiu), premium: Number(d.totalPremiumRequests ?? 0) };
        break;
      case 'hook.start':
        this.hooks++;
        break;
      default:
        break;
    }
  }

  snapshot(now: number, ctx: TrackerContext): TrackerSnapshot {
    const main = this.agents.get('main');
    const mainTool = main ? first(main.tools.values()) : undefined;
    const busy = !!main && (main.turns.size > 0 || main.tools.size > 0);
    const subs = [...this.subagents.values()];
    const runningSubs = subs.filter((s) => s.status === 'running');

    let state: AgentState;
    let activity = '';
    let category: ToolCategory | undefined;
    let pending: SessionSummary['pending'];

    const perm = first(this.permissions.values());
    if (this.shutdown && !ctx.live) {
      state = 'offline';
      activity = 'session closed';
    } else if (perm) {
      state = 'awaiting-permission';
      activity = `${perm.kind}: ${perm.text}`;
      pending = { kind: perm.kind, text: perm.text };
    } else if (this.question) {
      state = 'awaiting-input';
      activity = this.question.text;
      pending = { kind: 'question', text: this.question.text };
    } else if (this.compactionStart && now - this.compactionStart < COMPACTION_MAX_MS) {
      state = 'compacting';
      activity = 'compacting context';
    } else if (mainTool) {
      state = 'tool';
      activity = mainTool.label;
      category = mainTool.category;
    } else if (runningSubs.length) {
      state = 'tool';
      category = 'task';
      const s = runningSubs[0];
      activity = s.currentTool ? `${s.displayName}: ${s.currentTool}` : `${runningSubs.length} sub-agent${runningSubs.length > 1 ? 's' : ''} working`;
    } else if (busy || ctx.running) {
      state = 'thinking';
      activity = 'thinking…';
    } else if (this.lastError && now - this.lastError.ts < ERROR_VISIBLE_MS && this.lastError.ts >= this.lastEventAt - 60_000) {
      state = 'error';
      activity = this.lastError.message;
    } else if (this.lastTaskCompleteTs && this.lastTaskCompleteTs >= this.lastUserTs && now - this.lastTaskCompleteTs < DONE_VISIBLE_MS) {
      state = 'done';
      activity = 'task complete';
    } else if (ctx.live) {
      state = 'idle';
      activity = 'waiting for you';
    } else {
      state = 'offline';
      activity = 'not running';
    }

    const active = state === 'thinking' || state === 'tool' || state === 'awaiting-input' || state === 'awaiting-permission' || state === 'compacting';
    if (active && !ctx.live && !ctx.running && this.lastEventAt && now - this.lastEventAt > STALE_MS) {
      state = 'stalled';
      activity = 'no activity and no live process';
    }

    if (state !== this.lastState) {
      this.stateSince = this.lastState === null && this.lastEventAt ? this.lastEventAt : now;
      this.lastState = state;
    }

    return {
      state,
      stateSince: this.stateSince,
      activity,
      category,
      model: this.model,
      mode: this.mode,
      lastEventAt: this.lastEventAt,
      costAiu: this.usage ? this.usage.nanoAiu / 1e9 : undefined,
      premiumRequests: this.usage?.premium,
      toolCalls: this.toolCalls,
      turns: this.turns,
      hooks: this.hooks,
      subagents: subs.slice(-12),
      pending,
    };
  }

  itemsSince(rev: number): TimelineItem[] {
    return rev <= 0 ? this.items.slice() : this.items.filter((i) => i.rev > rev);
  }

  private agent(key: string): AgentRuntime {
    let a = this.agents.get(key);
    if (!a) {
      a = { turns: new Set(), tools: new Map() };
      this.agents.set(key, a);
    }
    return a;
  }

  private resetRuntime(): void {
    this.agents.clear();
    this.permissions.clear();
    this.question = undefined;
    this.compactionStart = null;
    for (const s of this.subagents.values()) if (s.status === 'running') s.status = 'done';
  }

  private toolStart(ev: RawEvent, ts: number, key: string): void {
    const d = ev.data ?? {};
    const name = String(d.toolName ?? 'tool');
    const callId = String(d.toolCallId ?? ev.id);
    const label = summarizeTool(name, d.arguments);
    const category = categoryOf(name);
    this.agent(key).tools.set(callId, { name, label, category, start: ts });
    this.toolCalls++;
    if (name === 'ask_user') this.question = { text: label, callId };
    const sub = key !== 'main' ? this.subagents.get(key) : undefined;
    if (sub) sub.currentTool = label;
    if (name === 'report_intent') return;
    this.push(ev, ts, { kind: 'tool', title: name, body: label, status: 'running', category }, `t:${callId}`);
  }

  private toolComplete(ev: RawEvent, ts: number, key: string): void {
    const d = ev.data ?? {};
    const callId = String(d.toolCallId ?? '');
    const agent = this.agent(key);
    const running = agent.tools.get(callId);
    agent.tools.delete(callId);
    if (this.question?.callId === callId) this.question = undefined;
    const sub = key !== 'main' ? this.subagents.get(key) : undefined;
    if (sub) sub.currentTool = undefined;
    const it = this.byId.get(`t:${callId}`);
    if (!it) return;
    const r = d.result;
    const text = typeof r === 'string' ? r : (r?.content ?? r?.detailedContent ?? '');
    it.status = d.success === false ? 'fail' : 'ok';
    if (running) it.durationMs = Math.max(0, ts - running.start);
    const out = safeText(text, 1800);
    it.body = out ? `${it.body ?? ''}\n\n${out}` : it.body;
    this.touch(it);
  }

  private subagentStarted(ev: RawEvent, ts: number): void {
    const d = ev.data ?? {};
    const agentId = String(ev.agentId ?? d.toolCallId ?? ev.id);
    const model = String(d.model ?? this.model);
    const info: SubAgentInfo = {
      agentId,
      name: String(d.agentName ?? 'agent'),
      displayName: String(d.agentDisplayName ?? d.agentName ?? 'sub-agent'),
      model,
      family: familyOf(model),
      tier: tierOf(model),
      description: d.agentDescription ? safeText(d.agentDescription, 200) : undefined,
      background: d.executionMode === 'background',
      startedAt: ts,
      status: 'running',
    };
    this.subagents.set(agentId, info);
    this.push(ev, ts, { kind: 'subagent', title: info.displayName, body: info.description, status: 'running' }, `a:${agentId}`);
  }

  private subagentEnded(ev: RawEvent, ts: number): void {
    const d = ev.data ?? {};
    const agentId = String(ev.agentId ?? d.toolCallId ?? '');
    const failed = ev.type === 'subagent.failed';
    const sub = this.subagents.get(agentId);
    if (sub) {
      sub.status = failed ? 'failed' : 'done';
      sub.endedAt = ts;
      sub.toolCalls = d.totalToolCalls;
      sub.currentTool = undefined;
    }
    this.agents.delete(agentId);
    const it = this.byId.get(`a:${agentId}`);
    if (it) {
      it.status = failed ? 'fail' : 'ok';
      if (d.durationMs != null) it.durationMs = Number(d.durationMs);
      const stats = `${d.totalToolCalls ?? 0} tool calls · ${d.totalTokens ?? 0} tokens`;
      it.body = [it.body, failed ? safeText(d.error, 300) : '', stats].filter(Boolean).join('\n');
      this.touch(it);
    }
  }

  private push(ev: RawEvent, ts: number, item: Omit<TimelineItem, 'rev' | 'id' | 'ts'>, id?: string): void {
    const it: TimelineItem = { ...item, id: id ?? `e:${ev.id ?? ts}`, ts, rev: ++this.rev, agentId: ev.agentId };
    this.items.push(it);
    this.byId.set(it.id, it);
    if (this.items.length > MAX_ITEMS) {
      for (const old of this.items.splice(0, this.items.length - MAX_ITEMS)) this.byId.delete(old.id);
    }
  }

  private touch(it: TimelineItem): void {
    it.rev = ++this.rev;
  }
}
