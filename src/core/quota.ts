/** The account's monthly AI-credit budget, as reported by the Copilot runtime (`session.rpc.quota.get()`). */
export interface Quota {
  /** Unit of every number below (the runtime reports "ai_credits"). */
  unit: string;
  /** Credits included in the plan for the period. */
  entitlement: number;
  /** Credits used so far, including anything above the entitlement. */
  consumed: number;
  /** Credits used above the entitlement (billed against the additional budget). */
  overage: number;
  /** Additional budget: how many credits beyond the entitlement may be spent. 0 = none set. */
  overageLimit: number;
  /** Whether usage may continue past the entitlement. */
  overageAllowed: boolean;
  unlimited: boolean;
  plan?: string;
  /** When the period resets (epoch ms), if the runtime says. */
  resetAt?: number;
  /** When the runtime observed these numbers (epoch ms). */
  observedAt: number;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Accepts only what a bridge may report: bounded numbers and short strings, everything else is dropped. */
export function cleanQuota(input: unknown, now = Date.now()): Quota | null {
  if (!input || typeof input !== 'object') return null;
  const r = input as Record<string, unknown>;
  const entitlement = num(r.entitlement);
  const consumed = num(r.consumed);
  if (entitlement === undefined || consumed === undefined || consumed < 0) return null;
  const unlimited = r.unlimited === true || entitlement < 0;
  const observed = num(r.observedAt);
  const resetAt = num(r.resetAt);
  return {
    unit: typeof r.unit === 'string' ? r.unit.replace(/[^\w .-]/g, '').slice(0, 20) || 'ai_credits' : 'ai_credits',
    entitlement: Math.max(0, entitlement),
    consumed,
    overage: Math.max(0, num(r.overage) ?? 0),
    overageLimit: Math.max(0, num(r.overageLimit) ?? 0),
    overageAllowed: r.overageAllowed === true,
    unlimited,
    plan: typeof r.plan === 'string' ? r.plan.replace(/[^\w .-]/g, '').slice(0, 30) : undefined,
    resetAt: resetAt !== undefined && resetAt > 0 ? resetAt : undefined,
    observedAt: observed !== undefined && observed > 0 && observed <= now + 60_000 ? observed : now,
  };
}

export type QuotaLevel = 'ok' | 'warn' | 'critical';

export interface QuotaView {
  unlimited: boolean;
  /** Included credits + additional budget. */
  totalLimit: number;
  includedUsed: number;
  additionalUsed: number;
  additionalLimit: number;
  remaining: number;
  /** 0..1 of the whole budget (included + additional). */
  usedFraction: number;
  /** Where the included part ends on the bar (0..1 of the whole budget). */
  includedFraction: number;
  level: QuotaLevel;
  exhausted: boolean;
  resetAt: number;
  resetEstimated: boolean;
}

/** The first moment of next month, UTC: when GitHub's monthly usage period rolls over. */
export function nextMonthStart(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

export function quotaView(q: Quota, now = Date.now()): QuotaView {
  const additionalLimit = q.overageLimit;
  const extra = q.entitlement > 0 ? Math.max(q.overage, q.consumed - q.entitlement, 0) : 0;
  const includedUsed = Math.min(q.consumed, q.entitlement);
  const totalLimit = q.entitlement + additionalLimit;
  const usedFraction = totalLimit > 0 ? Math.min(1, q.consumed / totalLimit) : 0;
  const level: QuotaLevel = usedFraction >= 0.95 ? 'critical' : usedFraction >= 0.8 ? 'warn' : 'ok';
  const resetEstimated = !q.resetAt || q.resetAt <= now;
  return {
    unlimited: q.unlimited,
    totalLimit,
    includedUsed,
    additionalUsed: extra,
    additionalLimit,
    remaining: Math.max(0, totalLimit - q.consumed),
    usedFraction,
    includedFraction: totalLimit > 0 ? q.entitlement / totalLimit : 1,
    level,
    exhausted: !q.unlimited && totalLimit > 0 && q.consumed >= totalLimit,
    resetAt: resetEstimated ? nextMonthStart(now) : q.resetAt!,
    resetEstimated,
  };
}

export function formatCredits(n: number): string {
  const rounded = Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10;
  return rounded.toLocaleString('en-US');
}
