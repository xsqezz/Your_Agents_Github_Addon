import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { familyOf, tierOf } from '../core/family.ts';
import type { SessionDetail, SessionSummary } from '../core/types.ts';
import { AppDb, type AppSessionInfo } from './appdb.ts';
import type { Source, SourceInfo } from './source.ts';
import { eventsPath, livePid, Tailer } from './tailer.ts';

const TICK_MS = 800;
const DB_REFRESH_MS = 2500;
const DIR_SCAN_MS = 6000;
const RECENT_MS = 6 * 3600_000;
const MAX_SESSIONS = 24;

export function resolveHome(arg?: string): string {
  return arg || process.env.COPILOT_HOME || path.join(os.homedir(), '.copilot');
}

interface Candidate {
  id: string;
  db?: AppSessionInfo;
  activity: number;
}

function parseTs(s?: string | null): number {
  const t = s ? Date.parse(s) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

/** Read-only view of what the Copilot app and CLI already persist under ~/.copilot. */
export class LiveSource implements Source {
  private home: string;
  private stateDir: string;
  private appDb: AppDb;
  private tailers = new Map<string, Tailer>();
  private order: string[] = [];
  private dbInfo = new Map<string, AppSessionInfo>();
  private liveSet = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private lastDbAt = 0;
  private lastScanAt = 0;
  private dirRecent = new Map<string, number>();
  private lastJson = '';
  private busy = false;
  private onUpdate: (list: SessionSummary[]) => void = () => {};

  constructor(home: string) {
    this.home = home;
    this.stateDir = path.join(home, 'session-state');
    this.appDb = new AppDb(path.join(home, 'data.db'));
  }

  info(): SourceInfo {
    return { mode: 'live', home: this.home };
  }

  async start(onUpdate: (list: SessionSummary[]) => void): Promise<void> {
    this.onUpdate = onUpdate;
    await this.tick();
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.appDb.close();
  }

  detail(id: string, since: number): SessionDetail | null {
    const t = this.tailers.get(id);
    if (!t) return null;
    return { id, rev: t.tracker.rev, items: t.tracker.itemsSince(since), source: t.hasEvents ? t.file : undefined };
  }

  private async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const now = Date.now();
      if (now - this.lastDbAt > DB_REFRESH_MS) {
        this.lastDbAt = now;
        this.dbInfo = new Map(this.appDb.listSessions().map((s) => [s.id, s]));
      }
      if (now - this.lastScanAt > DIR_SCAN_MS) {
        this.lastScanAt = now;
        this.scanStateDir(now);
      }
      await this.reconcile(now);
      for (const t of this.tailers.values()) t.poll();
      this.publish(now);
    } finally {
      this.busy = false;
    }
  }

  /** CLI sessions that never reached the app database still leave an events file behind. */
  private scanStateDir(now: number): void {
    this.dirRecent.clear();
    let names: string[] = [];
    try {
      names = fs.readdirSync(this.stateDir);
    } catch {
      return;
    }
    for (const id of names) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) continue;
      try {
        const st = fs.statSync(eventsPath(this.stateDir, id));
        if (now - st.mtimeMs < RECENT_MS) this.dirRecent.set(id, st.mtimeMs);
      } catch {
        /* no events file */
      }
    }
  }

  private async reconcile(now: number): Promise<void> {
    const pool = new Map<string, Candidate>();
    for (const [id, db] of this.dbInfo) pool.set(id, { id, db, activity: parseTs(db.updated_at) });
    for (const [id, mtime] of this.dirRecent) {
      const c = pool.get(id);
      if (c) c.activity = Math.max(c.activity, mtime);
      else pool.set(id, { id, activity: mtime });
    }

    this.liveSet.clear();
    const chosen: Candidate[] = [];
    for (const c of pool.values()) {
      const pid = livePid(this.stateDir, c.id);
      if (pid) this.liveSet.add(c.id);
      if (pid || c.db?.is_running || now - c.activity < RECENT_MS) chosen.push(c);
    }
    chosen.sort((a, b) => Number(this.liveSet.has(b.id)) - Number(this.liveSet.has(a.id)) || b.activity - a.activity);
    const keep = new Set(chosen.slice(0, MAX_SESSIONS).map((c) => c.id));

    for (const id of [...this.order]) {
      if (!keep.has(id)) {
        this.tailers.delete(id);
        this.order = this.order.filter((x) => x !== id);
      }
    }
    for (const c of chosen) {
      if (!keep.has(c.id) || this.tailers.has(c.id)) continue;
      const t = new Tailer(c.id, eventsPath(this.stateDir, c.id));
      this.tailers.set(c.id, t);
      this.order.push(c.id);
      t.poll();
      await new Promise((r) => setImmediate(r));
    }
  }

  private publish(now: number): void {
    const list: SessionSummary[] = [];
    for (const id of this.order) {
      const t = this.tailers.get(id);
      if (!t) continue;
      const db = this.dbInfo.get(id);
      const live = this.liveSet.has(id);
      const snap = t.tracker.snapshot(now, { live, running: !!db?.is_running });
      const model = snap.model || db?.model || '';
      const limit = db?.context_input_token_limit ?? undefined;
      const tokens = db?.context_current_tokens ?? undefined;
      list.push({
        id,
        title: db?.title?.trim() || db?.workspaceName || id.slice(0, 8),
        project: db?.project ?? undefined,
        branch: db?.branch ?? undefined,
        ...snap,
        model,
        mode: snap.mode ?? db?.mode ?? undefined,
        family: familyOf(model),
        tier: tierOf(model),
        live,
        contextTokens: tokens,
        contextLimit: limit,
        contextPct: limit && tokens != null ? Math.min(1, tokens / limit) : undefined,
        costAiu: snap.costAiu ?? (db?.total_nano_aiu != null ? db.total_nano_aiu / 1e9 : undefined),
        hasEvents: t.hasEvents,
      });
    }
    const json = JSON.stringify(list);
    if (json !== this.lastJson) {
      this.lastJson = json;
      this.onUpdate(list);
    }
  }
}
