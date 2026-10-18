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
