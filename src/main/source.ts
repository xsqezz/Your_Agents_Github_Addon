import type { SessionDetail, Snapshot } from '../core/types.ts';

export interface SourceInfo {
  mode: 'live' | 'demo';
  home: string;
}

export interface Source {
  info(): SourceInfo;
  start(onUpdate: (snapshot: Snapshot) => void): Promise<void>;
  stop(): void;
  detail(id: string, since: number): SessionDetail | null;
}

/** What starting a new agent needs from the live source: the room's folder and a way to file the new session under it. */
export interface LaunchTarget {
  roomDir(roomId: string): string | undefined;
  addHint(sessionId: string, roomId: string): void;
  /** True once the session has begun writing its event log. */
  sessionStarted(sessionId: string): boolean;
  /** Removes the empty session left behind by a start that failed. */
  discard(sessionId: string): void;
}
