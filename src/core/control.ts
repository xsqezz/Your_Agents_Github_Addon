export interface PendingItem {
  kind: 'permission' | 'input';
  requestId: string;
  label?: string;
  text: string;
  choices?: string[];
  allowFreeform?: boolean;
}

export interface ControlSession {
  connected: boolean;
  pending: PendingItem[];
}

export type BridgeInstall = 'none' | 'outdated' | 'current';

export interface ControlState {
  enabled: boolean;
  install: BridgeInstall;
  demo: boolean;
  installDir: string;
  sessions: Record<string, ControlSession>;
}

export type ControlCommand =
  | { type: 'send'; text: string; interrupt?: boolean }
  | { type: 'abort' }
  | { type: 'answer'; requestId: string; answer: string; freeform?: boolean }
  | { type: 'permission'; requestId: string; decision: 'approve' | 'reject' }
  | { type: 'setModel'; model: string };

export interface ControlResult {
  ok: boolean;
  error?: string;
  detail?: string;
}

export interface Controller {
  start(): Promise<void>;
  stop(): void;
  state(): ControlState;
  setEnabled(on: boolean): void;
  install(): ControlResult;
  uninstall(): ControlResult;
  send(sessionId: string, command: unknown): Promise<ControlResult>;
}
