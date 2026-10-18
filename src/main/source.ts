import type { SessionDetail, SessionSummary } from '../core/types.ts';

export interface SourceInfo {
  mode: 'live' | 'demo';
  home: string;
}

export interface Source {
  info(): SourceInfo;
  start(onUpdate: (list: SessionSummary[]) => void): Promise<void>;
  stop(): void;
  detail(id: string, since: number): SessionDetail | null;
}
