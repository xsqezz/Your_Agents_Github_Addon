import fs from 'node:fs';
import path from 'node:path';
import { SessionTracker } from '../core/reducer.ts';
import type { RawEvent } from '../core/types.ts';

const INITIAL_BYTES = 2 * 1024 * 1024;
const MAX_READ = 8 * 1024 * 1024;
const MAX_LINE = 3 * 1024 * 1024;

/** Follows one events.jsonl: reads the tail once, then only appended complete lines. */
export class Tailer {
  readonly file: string;
  readonly tracker: SessionTracker;
  hasEvents = false;
  private offset = 0;
  private carry: Buffer = Buffer.alloc(0);
  private started = false;

  constructor(id: string, file: string) {
    this.file = file;
    this.tracker = new SessionTracker(id);
  }

  /** Returns true when new events were consumed. */
  poll(): boolean {
    let size: number;
    try {
      size = fs.statSync(this.file).size;
    } catch {
      this.hasEvents = false;
      return false;
    }
    this.hasEvents = true;
    if (!this.started) {
      this.started = true;
      const start = Math.max(0, size - INITIAL_BYTES);
      this.readRange(start, size, start > 0);
      this.offset = size;
      return true;
    }
    if (size < this.offset) {
      // File was rewritten: start over from its tail.
      this.carry = Buffer.alloc(0);
      this.started = false;
      return this.poll();
    }
    if (size === this.offset) return false;
    const end = Math.min(size, this.offset + MAX_READ);
    this.readRange(this.offset, end, false);
    this.offset = end;
    return true;
  }

  private readRange(start: number, end: number, dropFirstPartialLine: boolean): void {
    const len = end - start;
    if (len <= 0) return;
    const fd = fs.openSync(this.file, 'r');
    try {
      const buf = Buffer.alloc(len);
      const read = fs.readSync(fd, buf, 0, len, start);
      this.consume(buf.subarray(0, read), dropFirstPartialLine);
    } finally {
      fs.closeSync(fd);
    }
  }

  private consume(bytes: Buffer, dropFirstPartialLine: boolean): void {
    let buf = this.carry.length ? Buffer.concat([this.carry, bytes]) : bytes;
    this.carry = Buffer.alloc(0);
    let from = 0;
    if (dropFirstPartialLine) {
      const nl = buf.indexOf(10);
      if (nl < 0) return;
      from = nl + 1;
    }
    const last = buf.lastIndexOf(10);
    if (last < from) {
      this.carry = Buffer.from(buf.subarray(from));
      return;
    }
    this.carry = Buffer.from(buf.subarray(last + 1));
    const text = buf.subarray(from, last + 1).toString('utf8');
    for (const line of text.split('\n')) this.ingestLine(line);
  }

  private ingestLine(line: string): void {
    if (!line) return;
    if (line.startsWith('{"type":"hook.')) {
      if (line.startsWith('{"type":"hook.start"')) this.tracker.countHook();
      return;
    }
    if (line.length > MAX_LINE || line.startsWith('{"type":"session.binary_asset"')) return;
    try {
      this.tracker.ingest(JSON.parse(line) as RawEvent);
    } catch {
      /* partial or foreign line */
    }
  }
}

export function eventsPath(stateDir: string, id: string): string {
  return path.join(stateDir, id, 'events.jsonl');
}

/** pid of a live CLI process holding the session, if any. */
export function livePid(stateDir: string, id: string): number | null {
  let names: string[];
  try {
    names = fs.readdirSync(path.join(stateDir, id));
  } catch {
    return null;
  }
  for (const name of names) {
    const m = /^inuse\.(\d+)\.lock$/.exec(name);
    if (!m) continue;
    const pid = Number(m[1]);
    try {
      process.kill(pid, 0);
      return pid;
    } catch (e: any) {
      if (e?.code === 'EPERM') return pid;
    }
  }
  return null;
}
