import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dataDir } from '../../bridge/protocol.mjs';
import { familyOf, tierOf } from '../core/family.ts';
import type { RoomInfo, SessionDetail, SessionSummary, Snapshot } from '../core/types.ts';
import { AppDb, type AppSessionInfo } from './appdb.ts';
import type { LaunchTarget, Source, SourceInfo } from './source.ts';
import { eventsPath, livePid, Tailer } from './tailer.ts';

const TICK_MS = 800;
const DB_REFRESH_MS = 2500;
const DIR_SCAN_MS = 6000;
const RECENT_MS = 3 * 24 * 3600_000;
const DESKS_PER_ROOM = 10;
const MAX_SESSIONS = 140;
const CHATS_ROOM = 'chats';
const OTHER_ROOM = 'other';

export function resolveHome(arg?: string): string {
  return arg || process.env.COPILOT_HOME || path.join(os.homedir(), '.copilot');
}

function dirExists(p: string | undefined): p is string {
  try {
    return !!p && fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Name the CLI wrote for a session that the app database does not know. */
function cliName(stateDir: string, id: string): string | undefined {
  try {
    const m = /^name:\s*(.+)$/m.exec(fs.readFileSync(path.join(stateDir, id, 'workspace.yaml'), 'utf8'));
    return m ? m[1].trim().replace(/^["']|["']$/g, '') || undefined : undefined;
  } catch {
    return undefined;
  }
}

interface Candidate {
  id: string;
  db?: AppSessionInfo;
  activity: number;
  room?: string;
}

function parseTs(s?: string | null): number {
  const t = s ? Date.parse(s) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

/** Read-only view of what the Copilot app and CLI already persist under ~/.copilot. */
export class LiveSource implements Source, LaunchTarget {
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
  private projects: { id: string; name: string; dir?: string }[] = [];
  private roomById = new Map<string, string>();
  private names = new Map<string, string | undefined>();
  private hints: Record<string, string> = {};
  private hintsFile: string;
  private onUpdate: (snapshot: Snapshot) => void = () => {};

  constructor(home: string) {
    this.home = home;
    this.stateDir = path.join(home, 'session-state');
    this.appDb = new AppDb(path.join(home, 'data.db'));
    this.hintsFile = path.join(dataDir(), 'launched.json');
    try {
      const saved = JSON.parse(fs.readFileSync(this.hintsFile, 'utf8'));
      if (saved && typeof saved === 'object') for (const [k, v] of Object.entries(saved)) if (typeof v === 'string') this.hints[k] = v;
    } catch {
      /* nothing launched yet */
    }
  }

  /** Folder a new agent in this room starts in. */
  roomDir(roomId: string): string | undefined {
    if (roomId === CHATS_ROOM) {
      const chats = path.join(this.home, 'chats');
      return dirExists(chats) ? chats : undefined;
    }
    const dir = this.projects.find((p) => p.id === roomId)?.dir;
    return dirExists(dir) ? dir : undefined;
  }

  /** The agent has really begun once the prompt is in its event log; a CLI without a login writes only start and shutdown. */
  sessionStarted(sessionId: string): boolean {
    try {
      return fs.readFileSync(eventsPath(this.stateDir, sessionId), 'utf8').includes('"type":"user.message"');
    } catch {
      return false;
    }
  }

  /** Removes the empty session a failed start leaves behind. */
  discard(sessionId: string): void {
    if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return;
    delete this.hints[sessionId];
    try {
      fs.rmSync(path.join(this.stateDir, sessionId), { recursive: true, force: true });
    } catch {
      /* it may still be held open for a moment; it is harmless */
    }
  }

  /** Files a session started from ur-agents under its room (the app database never hears of it). */
  addHint(sessionId: string, roomId: string): void {
    this.hints[sessionId] = roomId;
    try {
      fs.mkdirSync(path.dirname(this.hintsFile), { recursive: true });
      fs.writeFileSync(this.hintsFile, JSON.stringify(this.hints));
    } catch {
      /* the hint still works for this run */
    }
    this.lastScanAt = 0;
  }

  info(): SourceInfo {
    return { mode: 'live', home: this.home };
  }

  async start(onUpdate: (snapshot: Snapshot) => void): Promise<void> {
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
        this.projects = this.appDb.listProjects();
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
        if (now - st.mtimeMs < RECENT_MS || this.hints[id]) this.dirRecent.set(id, st.mtimeMs);
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
      const room = this.roomOf(c.db, c.id);
      if (!room) continue;
      // Sessions that belong to a folder keep their desk however old they are; strays only while recent.
      const owned = (!!c.db && room !== OTHER_ROOM) || !!this.hints[c.id];
      if (!(pid || c.db?.is_running || owned || now - c.activity < RECENT_MS)) continue;
      c.room = room;
      chosen.push(c);
    }
    const score = (c: Candidate): number => Number(this.liveSet.has(c.id)) * 2 + Number(!!c.db?.is_running);
    chosen.sort((a, b) => score(b) - score(a) || b.activity - a.activity);
    const perRoom = new Map<string, number>();
    const kept: Candidate[] = [];
    for (const c of chosen) {
      const n = perRoom.get(c.room!) ?? 0;
      if (n >= DESKS_PER_ROOM + 2 || kept.length >= MAX_SESSIONS) continue;
      perRoom.set(c.room!, n + 1);
      kept.push(c);
    }
    this.roomById = new Map(kept.map((c) => [c.id, c.room!]));
    const keep = new Set(kept.map((c) => c.id));

    for (const id of [...this.order]) {
      if (!keep.has(id)) {
        this.tailers.delete(id);
        this.order = this.order.filter((x) => x !== id);
      }
    }
    for (const c of kept) {
      if (this.tailers.has(c.id)) continue;
      const t = new Tailer(c.id, eventsPath(this.stateDir, c.id));
      this.tailers.set(c.id, t);
      this.order.push(c.id);
      t.poll();
      await new Promise((r) => setImmediate(r));
    }
  }

  /** Which room a session lives in: its project folder, Chats, or Other (CLI sessions the app does not know). */
  private roomOf(db: AppSessionInfo | undefined, id: string): string | null {
    if (db?.session_type === 'general_chat') return CHATS_ROOM;
    if (db?.session_type === 'side_chat') return null;
    if (db?.projectId && this.projects.length) return this.projects.some((p) => p.id === db.projectId) ? db.projectId : null;
    const hint = this.hints[id];
    if (hint && (hint === CHATS_ROOM || this.projects.some((p) => p.id === hint))) return hint;
    return OTHER_ROOM;
  }

  private rooms(used: Set<string>): RoomInfo[] {
    const rooms: RoomInfo[] = this.projects.map((p) => ({ id: p.id, name: p.name, kind: 'project', canLaunch: dirExists(p.dir) }));
    rooms.push({ id: CHATS_ROOM, name: 'Chats', kind: 'chats', canLaunch: dirExists(path.join(this.home, 'chats')) });
    if (used.has(OTHER_ROOM)) rooms.push({ id: OTHER_ROOM, name: 'Other sessions', kind: 'other', canLaunch: false });
    return rooms;
  }

  private cliTitle(id: string): string {
    if (!this.names.has(id) || this.names.get(id) === undefined) this.names.set(id, cliName(this.stateDir, id));
    return this.names.get(id) || id.slice(0, 8);
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
        room: this.roomById.get(id) ?? OTHER_ROOM,
        title: db?.title?.trim() || db?.workspaceName || this.cliTitle(id),
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
    const snapshot: Snapshot = { rooms: this.rooms(new Set(list.map((s) => s.room))), sessions: list };
    const json = JSON.stringify(snapshot);
    if (json !== this.lastJson) {
      this.lastJson = json;
      this.onUpdate(snapshot);
    }
  }
}
