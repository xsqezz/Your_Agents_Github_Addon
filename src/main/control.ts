import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { dataDir, describeCommand, PROTOCOL_VERSION, validateCommand } from '../../bridge/protocol.mjs';
import type { BridgeInstall, ControlResult, ControlSession, ControlState, Controller, PendingItem } from '../core/control.ts';
import { cleanQuota, type Quota } from '../core/quota.ts';
import { safeText } from '../core/redact.ts';

const FILES = ['extension.mjs', 'core.mjs', 'protocol.mjs'];
const POLL_HOLD_MS = 25_000;
const CONNECTED_MS = 50_000;
const RESULT_TIMEOUT_MS = 20_000;
const MAX_BODY = 1_000_000;
const AUDIT_MAX = 2_000_000;

interface Queued {
  id: string;
  command: unknown;
}

interface Waiter {
  res: http.ServerResponse;
  timer: NodeJS.Timeout;
}

interface BridgeSession {
  lastSeen: number;
  pending: PendingItem[];
  queue: Queued[];
  waiter?: Waiter;
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

/** Normalises what a bridge reports: bounded, typed and stripped of secrets before it reaches the UI. */
function cleanPending(input: unknown): PendingItem[] {
  if (!Array.isArray(input)) return [];
  const out: PendingItem[] = [];
  for (const raw of input.slice(0, 20)) {
    if (!raw || typeof raw !== 'object') continue;
    const p = raw as Record<string, unknown>;
    if ((p.kind !== 'permission' && p.kind !== 'input') || typeof p.requestId !== 'string' || p.requestId.length > 200) continue;
    out.push({
      kind: p.kind,
      requestId: p.requestId,
      label: typeof p.label === 'string' ? p.label.slice(0, 60) : undefined,
      text: safeText(p.text, 3000),
      choices: Array.isArray(p.choices) ? p.choices.filter((c): c is string => typeof c === 'string').map((c) => safeText(c, 200)).slice(0, 20) : undefined,
      allowFreeform: p.allowFreeform !== false,
    });
  }
  return out;
}

/** Local, loopback-only server that the per-session bridge extensions connect to. Commands go out only while control is switched on. */
export class ControlServer implements Controller {
  private dir: string;
  private installDir: string;
  private bridgeSource: string;
  private onChange: () => void;
  private server: http.Server | null = null;
  private port = 0;
  private token = crypto.randomBytes(32).toString('hex');
  private sessions = new Map<string, BridgeSession>();
  private results = new Map<string, { resolve: (r: ControlResult) => void; timer: NodeJS.Timeout }>();
  private enabled: boolean;
  private quota: Quota | undefined;

  constructor(opts: { copilotHome: string; bridgeSource: string; onChange: () => void }) {
    this.dir = dataDir();
    this.installDir = path.join(opts.copilotHome, 'extensions', 'ur-agents-bridge');
    this.bridgeSource = opts.bridgeSource;
    this.onChange = opts.onChange;
    this.enabled = readJson<{ controlEnabled?: boolean }>(path.join(this.dir, 'settings.json'), {}).controlEnabled === true;
    // The last known budget survives restarts, so the sidebar is not empty until a session reports again.
    this.quota = cleanQuota(readJson<unknown>(path.join(this.dir, 'quota.json'), null)) ?? undefined;
  }

  async start(): Promise<void> {
    fs.mkdirSync(this.dir, { recursive: true });
    this.server = http.createServer((req, res) => void this.handle(req, res));
    this.server.on('clientError', (_e, socket) => socket.destroy());
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    this.port = (this.server.address() as { port: number }).port;
    fs.writeFileSync(path.join(this.dir, 'bridge.json'), JSON.stringify({ port: this.port, token: this.token, pid: process.pid, protocol: PROTOCOL_VERSION }), { mode: 0o600 });
    setInterval(() => this.onChange(), 10_000).unref();
  }

  stop(): void {
    try {
      fs.rmSync(path.join(this.dir, 'bridge.json'), { force: true });
    } catch {
      /* already gone */
    }
    for (const s of this.sessions.values()) if (s.waiter) this.release(s);
    this.server?.close();
    this.server = null;
  }

  state(): ControlState {
    const now = Date.now();
    const sessions: Record<string, ControlSession> = {};
    for (const [id, s] of this.sessions) sessions[id] = { connected: now - s.lastSeen < CONNECTED_MS, pending: s.pending };
    return { enabled: this.enabled, install: this.installState(), demo: false, installDir: this.installDir, sessions, quota: this.quota };
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    try {
      const file = path.join(this.dir, 'settings.json');
      fs.writeFileSync(file, JSON.stringify({ ...readJson<object>(file, {}), controlEnabled: on }));
    } catch {
      /* setting stays in memory */
    }
    this.audit('-', on ? 'control switched on' : 'control switched off', true);
    this.onChange();
  }

  private installState(): BridgeInstall {
    try {
      for (const f of FILES) if (!fs.existsSync(path.join(this.installDir, f))) return 'none';
      for (const f of FILES) {
        if (!fs.readFileSync(path.join(this.installDir, f)).equals(fs.readFileSync(path.join(this.bridgeSource, f)))) return 'outdated';
      }
      return 'current';
    } catch {
      return fs.existsSync(path.join(this.installDir, 'extension.mjs')) ? 'outdated' : 'none';
    }
  }

  install(): ControlResult {
    try {
      fs.mkdirSync(this.installDir, { recursive: true });
      for (const f of FILES) fs.copyFileSync(path.join(this.bridgeSource, f), path.join(this.installDir, f));
      this.audit('-', `bridge installed to ${this.installDir}`, true);
      this.onChange();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String((e as Error).message) };
    }
  }

  uninstall(): ControlResult {
    try {
      fs.rmSync(this.installDir, { recursive: true, force: true });
      this.audit('-', 'bridge removed', true);
      this.onChange();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String((e as Error).message) };
    }
  }

  async send(sessionId: string, raw: unknown): Promise<ControlResult> {
    if (!this.enabled) return { ok: false, error: 'Control is switched off.' };
    const v = validateCommand(raw);
    if (!v.ok) return { ok: false, error: v.error };
    const s = this.sessions.get(sessionId);
    if (!s || Date.now() - s.lastSeen >= CONNECTED_MS) return { ok: false, error: 'This session has no bridge loaded.' };

    const id = crypto.randomUUID();
    const done = new Promise<ControlResult>((resolve) => {
      const timer = setTimeout(() => {
        this.results.delete(id);
        s.queue = s.queue.filter((q) => q.id !== id);
        resolve({ ok: false, error: 'The session did not answer in time.' });
      }, RESULT_TIMEOUT_MS);
      this.results.set(id, { resolve, timer });
    });
    s.queue.push({ id, command: v.cmd });
    this.flush(s);
    const result = await done;
    this.audit(sessionId, describeCommand(v.cmd), result.ok, result.error);
    return result;
  }

  private flush(s: BridgeSession): void {
    if (!s.waiter || !s.queue.length) return;
    const next = s.queue.shift()!;
    const { res, timer } = s.waiter;
    clearTimeout(timer);
    s.waiter = undefined;
    this.json(res, 200, next);
  }

  private release(s: BridgeSession): void {
    if (!s.waiter) return;
    clearTimeout(s.waiter.timer);
    try {
      s.waiter.res.writeHead(204).end();
    } catch {
      /* socket already closed */
    }
    s.waiter = undefined;
  }

  private audit(sessionId: string, what: string, ok: boolean, error?: string): void {
    try {
      const file = path.join(this.dir, 'audit.jsonl');
      if (fs.existsSync(file) && fs.statSync(file).size > AUDIT_MAX) fs.renameSync(file, `${file}.1`);
      fs.appendFileSync(file, `${JSON.stringify({ ts: new Date().toISOString(), session: sessionId, what, ok, error })}\n`);
    } catch {
      /* auditing must never break control */
    }
  }

  private json(res: http.ServerResponse, status: number, body: unknown): void {
    const text = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text), 'cache-control': 'no-store' });
    res.end(text);
  }

  private authorised(req: http.IncomingMessage): boolean {
    if (req.headers.origin) return false;
    if (req.headers.host !== `127.0.0.1:${this.port}`) return false;
    const given = Buffer.from(String(req.headers.authorization ?? ''));
    const want = Buffer.from(`Bearer ${this.token}`);
    return given.length === want.length && crypto.timingSafeEqual(given, want);
  }

  private body(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > MAX_BODY) {
          reject(new Error('too large'));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => {
        try {
          const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve(v && typeof v === 'object' ? v : {});
        } catch {
          reject(new Error('bad json'));
        }
      });
      req.on('error', reject);
    });
  }

  private session(id: unknown): BridgeSession | null {
    if (typeof id !== 'string' || !/^[0-9a-zA-Z._-]{1,100}$/.test(id)) return null;
    let s = this.sessions.get(id);
    if (!s) {
      s = { lastSeen: 0, pending: [], queue: [] };
      this.sessions.set(id, s);
    }
    s.lastSeen = Date.now();
    return s;
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      if (!this.authorised(req)) return this.json(res, 401, { error: 'unauthorised' });
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');

      if (req.method === 'GET' && url.pathname === '/b/poll') {
        const s = this.session(url.searchParams.get('sid'));
        if (!s) return this.json(res, 400, { error: 'bad session' });
        this.release(s);
        const timer = setTimeout(() => this.release(s), POLL_HOLD_MS);
        s.waiter = { res, timer };
        res.on('close', () => {
          if (s.waiter?.res === res) {
            clearTimeout(timer);
            s.waiter = undefined;
          }
        });
        this.flush(s);
        return;
      }
      if (req.method !== 'POST') return this.json(res, 405, { error: 'method' });
      const b = await this.body(req);

      if (url.pathname === '/b/hello' || url.pathname === '/b/state') {
        const s = this.session(b.sessionId);
        if (!s) return this.json(res, 400, { error: 'bad session' });
        s.pending = cleanPending(b.pending);
        this.onChange();
        return this.json(res, 200, { ok: true, enabled: this.enabled });
      }
      if (url.pathname === '/b/quota') {
        this.session(b.sessionId);
        const q = cleanQuota(b.quota);
        if (q && (!this.quota || q.observedAt >= this.quota.observedAt)) {
          this.quota = q;
          try {
            fs.writeFileSync(path.join(this.dir, 'quota.json'), JSON.stringify(q));
          } catch {
            /* kept in memory */
          }
          this.onChange();
        }
        return this.json(res, 200, { ok: true });
      }
      if (url.pathname === '/b/result') {
        this.session(b.sessionId);
        const r = typeof b.id === 'string' ? this.results.get(b.id) : undefined;
        if (r) {
          clearTimeout(r.timer);
          this.results.delete(b.id as string);
          r.resolve({ ok: b.ok === true, error: typeof b.error === 'string' ? safeText(b.error, 300) : undefined, detail: typeof b.detail === 'string' ? b.detail.slice(0, 100) : undefined });
        }
        return this.json(res, 200, { ok: true });
      }
      this.json(res, 404, { error: 'not found' });
    } catch {
      try {
        this.json(res, 400, { error: 'bad request' });
      } catch {
        /* already responded */
      }
    }
  }
}
