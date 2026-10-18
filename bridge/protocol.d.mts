export const PROTOCOL_VERSION: number;
export const MAX_TEXT: number;
export const MAX_ID: number;
export const COMMAND_TYPES: readonly string[];
export function dataDir(): string;

export type Command =
  | { type: 'send'; text: string; interrupt: boolean }
  | { type: 'abort' }
  | { type: 'answer'; requestId: string; answer: string; freeform: boolean }
  | { type: 'permission'; requestId: string; decision: 'approve' | 'reject' }
  | { type: 'setModel'; model: string };

export function validateCommand(c: unknown): { ok: true; cmd: Command } | { ok: false; error: string };
export function describeCommand(cmd: Command): string;
