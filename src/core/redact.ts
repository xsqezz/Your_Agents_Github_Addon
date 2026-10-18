const PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
];

export function redact(text: string): string {
  let out = text;
  for (const rx of PATTERNS) out = out.replace(rx, '[redacted]');
  return out;
}

/** Keeps head and tail of long text so both the start and the outcome stay visible. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.7);
  const tail = max - head;
  return `${text.slice(0, head)}\n… ${text.length - max} chars hidden …\n${text.slice(text.length - tail)}`;
}

export function safeText(value: unknown, max: number): string {
  if (value == null) return '';
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  return truncate(redact(raw), max);
}
