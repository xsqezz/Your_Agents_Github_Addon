export interface BridgeConfig {
  port: number;
  token: string;
  pid?: number;
}

export interface BridgePending {
  kind: 'permission' | 'input';
  requestId: string;
  label?: string;
  text: string;
  choices?: string[];
  allowFreeform?: boolean;
}

export interface BridgeOptions {
  readConfig: () => BridgeConfig | null;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
  retryMs?: number;
  idleMs?: number;
  pollTimeoutMs?: number;
}

export function createBridge(
  session: any,
  options: BridgeOptions,
): {
  start(): void;
  stop(): void;
  execute(command: unknown): Promise<{ ok: boolean; error?: string; detail?: string }>;
  snapshot(): { pending: BridgePending[] };
};
