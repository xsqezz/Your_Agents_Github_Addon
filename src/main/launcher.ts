import crypto from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from '../../bridge/protocol.mjs';
import { buildArgs, parseLaunch, type LaunchResult } from '../core/launch.ts';
import type { LaunchTarget } from './source.ts';

const MAX_RUNNING = 6;
const START_WAIT_MS = 25_000;

export interface Launcher {
  launch(input: unknown): Promise<LaunchResult>;
  signIn(): LaunchResult;
}

function versionKey(v: string): number[] {
  return v.split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0);
}

/** The Copilot CLI the app itself runs, else whatever `copilot` is on PATH. */
export function findCli(): string {
  const env = process.env.UR_AGENTS_COPILOT;
  if (env && fs.existsSync(env)) return env;
  const exe = process.platform === 'win32' ? 'copilot.exe' : 'copilot';
  const root = path.join(process.env.LOCALAPPDATA || '', 'github-copilot-sdk', 'cli');
  try {
    const versions = fs
      .readdirSync(root)
      .filter((v) => fs.existsSync(path.join(root, v, exe)))
      .sort((a, b) => {
        const x = versionKey(a);
        const y = versionKey(b);
        for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
        return 0;
      });
    if (versions.length) return path.join(root, versions[0], exe);
  } catch {
    /* fall through to PATH */
  }
  return 'copilot';
}

/** Starts a one-shot Copilot CLI run in a room's folder. It shows up as a new agent at a desk in that room. */
export class CliLauncher implements Launcher {
  private target: LaunchTarget;
  private enabled: () => boolean;
  private running = new Set<ChildProcess>();

  constructor(target: LaunchTarget, enabled: () => boolean) {
    this.target = target;
    this.enabled = enabled;
  }

  async launch(input: unknown): Promise<LaunchResult> {
    if (!this.enabled()) return { ok: false, error: 'Control is switched off.' };
    const parsed = parseLaunch(input);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const req = parsed.req;
    const cwd = this.target.roomDir(req.room);
    if (!cwd) return { ok: false, error: 'This room has no folder to work in.' };
    if (this.running.size >= MAX_RUNNING) return { ok: false, error: `Already ${MAX_RUNNING} agents started from here are still running.` };

    const sessionId = crypto.randomUUID();
    const exe = findCli();
    const logFile = path.join(dataDir(), 'launches', `${sessionId}.log`);
    let log = -1;
    try {
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      log = fs.openSync(logFile, 'a');
    } catch {
      /* without a log the start still works, only the failure reason is lost */
    }
    let child: ChildProcess;
    try {
      child = spawn(exe, buildArgs(req, sessionId), { cwd, detached: true, stdio: ['ignore', log >= 0 ? log : 'ignore', log >= 0 ? log : 'ignore'], windowsHide: true });
    } catch (e) {
      if (log >= 0) fs.closeSync(log);
      return { ok: false, error: `Could not start Copilot: ${(e as Error).message}` };
    }
    if (log >= 0) fs.closeSync(log);
    this.running.add(child);

    // The agent has really started once its session writes events; if the CLI exits first, it failed and says why in its log.
    const outcome = await new Promise<{ kind: 'started' } | { kind: 'failed'; reason: string } | { kind: 'slow' }>((resolve) => {
      let done = false;
      const finish = (v: { kind: 'started' } | { kind: 'failed'; reason: string } | { kind: 'slow' }): void => {
        if (done) return;
        done = true;
        clearInterval(poll);
        clearTimeout(timer);
        resolve(v);
      };
      const poll = setInterval(() => {
        if (this.target.sessionStarted(sessionId)) finish({ kind: 'started' });
      }, 300);
      const timer = setTimeout(() => finish({ kind: 'slow' }), START_WAIT_MS);
      child.once('error', (e) => finish({ kind: 'failed', reason: (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'The Copilot CLI was not found.' : e.message }));
      child.once('exit', (code) => {
        this.running.delete(child);
        if (!this.target.sessionStarted(sessionId)) finish({ kind: 'failed', reason: `exit ${code ?? '?'}` });
      });
    });
    if (outcome.kind === 'failed') {
      this.running.delete(child);
      const text = readTail(logFile);
      setTimeout(() => this.target.discard(sessionId), 1500);
      if (/no authentication information|not (logged|signed) in|run .?copilot login|unauthori[sz]ed/i.test(text)) {
        return { ok: false, needsLogin: true, error: 'The Copilot CLI is not signed in, so it cannot start agents on its own. Sign in once and try again.' };
      }
      const detail = text.split('\n').map((l) => l.trim()).filter(Boolean).slice(-3).join(' ');
      return { ok: false, error: `Copilot stopped right after starting (${outcome.reason}).${detail ? ` ${detail.slice(0, 300)}` : ''}` };
    }
    child.unref();
    this.target.addHint(sessionId, req.room);
    pruneLogs(path.dirname(logFile));
    return outcome.kind === 'slow' ? { ok: true, sessionId, note: 'Agent is still starting; it takes a desk as soon as it begins.' } : { ok: true, sessionId };
  }

  /** Opens the CLI's own sign-in (device code) in a normal terminal window. */
  signIn(): LaunchResult {
    try {
      const exe = findCli();
      if (process.platform === 'win32') spawn('cmd.exe', ['/c', 'start', 'ur-agents: copilot login', exe, 'login'], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
      else spawn(exe, ['login'], { detached: true, stdio: 'ignore' }).unref();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: `Could not open the sign-in: ${(e as Error).message}` };
    }
  }
}

function readTail(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8').slice(-4000);
  } catch {
    return '';
  }
}

function pruneLogs(dir: string): void {
  try {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (Date.now() - fs.statSync(p).mtimeMs > 3 * 24 * 3600_000) fs.rmSync(p, { force: true });
    }
  } catch {
    /* housekeeping only */
  }
}

/** Demo mode never starts a process. */
export class DemoLauncher implements Launcher {
  private enabled: () => boolean;

  constructor(enabled: () => boolean) {
    this.enabled = enabled;
  }

  async launch(input: unknown): Promise<LaunchResult> {
    if (!this.enabled()) return { ok: false, error: 'Control is switched off.' };
    const parsed = parseLaunch(input);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    return { ok: true, note: 'Demo mode: nothing was started.' };
  }

  signIn(): LaunchResult {
    return { ok: true, note: 'Demo mode: nothing was opened.' };
  }
}
