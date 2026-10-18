import { familyOf, tierOf } from '../core/family.ts';
import type { AgentState, SessionDetail, SessionSummary, SubAgentInfo, TimelineItem, ToolCategory } from '../core/types.ts';
import type { Source, SourceInfo } from './source.ts';

interface Step {
  state: AgentState;
  activity: string;
  category?: ToolCategory;
  tool?: string;
  subs?: number;
  pending?: { kind: string; text: string };
}

const SEQ: Step[] = [
  { state: 'tool', category: 'shell', tool: 'powershell', activity: 'npm test -- --watch=false' },
  { state: 'tool', category: 'read', tool: 'view', activity: 'src/billing/invoice.ts' },
  { state: 'tool', category: 'write', tool: 'apply_patch', activity: 'patch src/billing/tax.ts' },
  { state: 'tool', category: 'web', tool: 'web_search', activity: 'search the web: postgres 17 migration' },
  { state: 'tool', category: 'task', tool: 'task', activity: 'Explorer: search “retry”', subs: 3 },
  { state: 'thinking', activity: 'thinking…' },
  { state: 'awaiting-input', activity: 'Which database should I target?', pending: { kind: 'question', text: 'Which database should I target?' } },
  { state: 'awaiting-permission', activity: 'shell: git push --force', pending: { kind: 'shell', text: 'git push --force' } },
  { state: 'compacting', activity: 'compacting context' },
  { state: 'error', activity: 'Failed to get response from the AI model' },
  { state: 'done', activity: 'task complete' },
  { state: 'idle', activity: 'waiting for you' },
  { state: 'offline', activity: 'not running' },
  { state: 'stalled', activity: 'no activity and no live process' },
];

const MODELS = [
  'claude-opus-5', 'gpt-6-astra', 'gemini-4-argon', 'grok-4.7', 'mai-code-1.1-flash', 'mystery-model-1', 'claude-sonnet-5.5',
  'gpt-5.3-codex', 'gemini-3.8-flash', 'grok-4.5', 'claude-haiku-5.5', 'gpt-5.4-mini', 'claude-sonnet-5', 'gemini-3.7-flash',
];

const TITLES = [
  'Refactor billing service', 'Migrate to Postgres 17', 'Write API v2 docs', 'Fix flaky checkout test', 'Add dark mode',
  'Triage crash reports', 'Speed up CI pipeline', 'Port parser to Rust', 'Review auth PR', 'Clean up feature flags',
  'Upgrade Electron', 'Localize onboarding', 'Audit dependencies', 'Prototype search UI',
];

const SUB_NAMES = ['Explorer', 'Researcher', 'Builder'];
const SUB_MODELS = ['gpt-6-astra', 'claude-sonnet-5', 'gemini-3.8-flash'];

const SEGMENT_MS = Number(process.env.UR_DEMO_SEGMENT_MS) || 7000;

interface DemoAgent {
  index: number;
  rev: number;
  items: TimelineItem[];
  lastSegment: number;
  running?: TimelineItem;
}

export class DemoSource implements Source {
  private agents: DemoAgent[] = [];
  private timer: NodeJS.Timeout | null = null;
  private lastJson = '';
  private startedAt = Date.now();
  private onUpdate: (list: SessionSummary[]) => void = () => {};

  info(): SourceInfo {
    return { mode: 'demo', home: 'synthetic demo data' };
  }

  async start(onUpdate: (list: SessionSummary[]) => void): Promise<void> {
    this.onUpdate = onUpdate;
    this.agents = TITLES.map((_, index) => {
      const a: DemoAgent = { index, rev: 0, items: [], lastSegment: -1 };
      this.add(a, { kind: 'user', title: 'Prompt', body: `Please work on: ${TITLES[index]}.` });
      this.add(a, { kind: 'assistant', title: 'Agent', body: 'On it. I will start by reading the relevant code and running the tests.' });
      return a;
    });
    this.tick();
    this.timer = setInterval(() => this.tick(), 700);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  detail(id: string, since: number): SessionDetail | null {
    const a = this.agents[Number(id.replace('demo-', ''))];
    if (!a) return null;
    return { id, rev: a.rev, items: since <= 0 ? a.items.slice() : a.items.filter((i) => i.rev > since), source: undefined };
  }

  private add(a: DemoAgent, item: Omit<TimelineItem, 'id' | 'rev' | 'ts'>): TimelineItem {
    const it: TimelineItem = { ...item, id: `d${a.index}-${a.items.length}`, rev: ++a.rev, ts: Date.now() };
    a.items.push(it);
    return it;
  }

  private stepIndex(a: DemoAgent, now: number): number {
    return Math.floor((now - this.startedAt) / SEGMENT_MS) + a.index;
  }

  private tick(): void {
    const now = Date.now();
    const list: SessionSummary[] = [];
    for (const a of this.agents) {
      const seg = this.stepIndex(a, now);
      const step = SEQ[seg % SEQ.length];
      if (seg !== a.lastSegment) {
        a.lastSegment = seg;
        if (a.running) {
          a.running.status = 'ok';
          a.running.durationMs = SEGMENT_MS;
          a.running.rev = ++a.rev;
          a.running = undefined;
        }
        if (step.tool) a.running = this.add(a, { kind: 'tool', title: step.tool, body: step.activity, status: 'running', category: step.category });
        else if (step.pending) this.add(a, { kind: 'permission', title: `Waiting: ${step.pending.kind}`, body: step.pending.text, status: 'pending' });
        else if (step.state === 'error') this.add(a, { kind: 'system', title: 'Error', body: step.activity, status: 'fail' });
        else if (step.state === 'done') this.add(a, { kind: 'system', title: 'Task complete', body: 'All checks pass.', status: 'ok' });
        else if (step.state === 'thinking') this.add(a, { kind: 'assistant', title: 'Agent', body: 'Let me think about the cleanest way to do this.' });
      }
      const model = MODELS[a.index % MODELS.length];
      const segStart = this.startedAt + (seg - a.index) * SEGMENT_MS;
      const subagents: SubAgentInfo[] = [];
      for (let s = 0; s < (step.subs ?? 0); s++) {
        const m = SUB_MODELS[(a.index + s) % SUB_MODELS.length];
        subagents.push({
          agentId: `demo-${a.index}-sub${s}`, name: 'explore', displayName: SUB_NAMES[s % SUB_NAMES.length], model: m,
          family: familyOf(m), tier: tierOf(m), background: true, startedAt: segStart, status: 'running', currentTool: 'rg',
        });
      }
      const live = step.state !== 'offline';
      list.push({
        id: `demo-${a.index}`,
        title: TITLES[a.index],
        project: ['ur-agents', 'billing', 'docs', 'web'][a.index % 4],
        branch: `feat/${TITLES[a.index].toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}`,
        model, family: familyOf(model), tier: tierOf(model),
        mode: a.index % 3 === 0 ? 'autopilot' : 'interactive',
        state: step.state, stateSince: segStart, activity: step.activity, category: step.category,
        live, lastEventAt: now - 800,
        contextPct: 0.12 + ((a.index * 0.071 + (seg % 5) * 0.02) % 0.8),
        contextTokens: 20000 + a.index * 9000, contextLimit: 200000,
        costAiu: 1.4 + a.index * 2.7, premiumRequests: a.index + 1,
        toolCalls: 30 + a.index * 11, turns: 4 + a.index, hooks: 120 + a.index * 40,
        subagents, pending: step.pending, hasEvents: true,
      });
    }
    const json = JSON.stringify(list);
    if (json !== this.lastJson) {
      this.lastJson = json;
      this.onUpdate(list);
    }
  }
}
