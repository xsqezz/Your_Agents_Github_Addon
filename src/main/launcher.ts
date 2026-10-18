import crypto from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { buildArgs, parseLaunch, type LaunchResult } from '../core/launch.ts';
import type { LaunchTarget } from './source.ts';

const MAX_RUNNING = 6;
const SPAWN_WAIT_MS = 4000;

export interface Launcher {
  launch(input: unknown): Promise<LaunchResult>;
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
    let child: ChildProcess;
    try {
      child = spawn(exe, buildArgs(req, sessionId), { cwd, detached: true, stdio: 'ignore', windowsHide: true });
    } catch (e) {
      return { ok: false, error: `Could not start Copilot: ${(e as Error).message}` };
    }
    const started = await new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), SPAWN_WAIT_MS);
      child.once('spawn', () => {
        clearTimeout(timer);
        resolve(null);
      });
      child.once('error', (e) => {
        clearTimeout(timer);
        resolve((e as NodeJS.ErrnoException).code === 'ENOENT' ? 'The Copilot CLI was not found.' : `Could not start Copilot: ${e.message}`);
      });
    });
    if (started) return { ok: false, error: started };
    this.running.add(child);
    child.once('exit', () => this.running.delete(child));
    child.unref();
    this.target.addHint(sessionId, req.room);
    return { ok: true, sessionId };
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
}
