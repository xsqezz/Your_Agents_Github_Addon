import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanQuota, nextMonthStart, quotaView } from '../src/core/quota.ts';

const NOW = Date.UTC(2026, 9, 19, 12, 0, 0);
const base = { unit: 'ai_credits', entitlement: 60000, consumed: 59460, overage: 0, overageLimit: 0, overageAllowed: true, unlimited: false, plan: 'business', observedAt: NOW };

test('quota: the real runtime payload is accepted', () => {
  const q = cleanQuota(base, NOW);
  assert.ok(q);
  assert.equal(q!.entitlement, 60000);
  assert.equal(q!.plan, 'business');
});

test('quota: junk is rejected or clamped', () => {
  assert.equal(cleanQuota(null), null);
  assert.equal(cleanQuota({ entitlement: 'x', consumed: 1 }), null);
  assert.equal(cleanQuota({ entitlement: 10, consumed: -5 }), null);
  const q = cleanQuota({ ...base, plan: '<b>x</b>', observedAt: NOW + 10 * 3600_000 }, NOW)!;
  assert.ok(!q.plan!.includes('<'));
  assert.equal(q.observedAt, NOW);
  assert.equal(cleanQuota({ ...base, entitlement: -1 }, NOW)!.unlimited, true);
});

test('quota view: included budget only', () => {
  const v = quotaView(cleanQuota(base, NOW)!, NOW);
  assert.equal(v.totalLimit, 60000);
  assert.equal(v.remaining, 540);
  assert.equal(v.level, 'critical');
  assert.equal(v.exhausted, false);
  assert.equal(v.additionalUsed, 0);
});

test('quota view: the additional budget extends the limit', () => {
  const q = cleanQuota({ ...base, consumed: 61200, overage: 1200, overageLimit: 5000 }, NOW)!;
  const v = quotaView(q, NOW);
  assert.equal(v.totalLimit, 65000);
  assert.equal(v.includedUsed, 60000);
  assert.equal(v.additionalUsed, 1200);
  assert.equal(v.remaining, 3800);
  assert.equal(v.exhausted, false);
  assert.ok(Math.abs(v.includedFraction - 60000 / 65000) < 1e-9);
  assert.equal(v.level, 'warn');
});

test('quota view: exhausted once included and additional credits are gone', () => {
  const v = quotaView(cleanQuota({ ...base, consumed: 65000, overage: 5000, overageLimit: 5000 }, NOW)!, NOW);
  assert.equal(v.exhausted, true);
  assert.equal(v.remaining, 0);
  assert.equal(v.usedFraction, 1);
  const over = quotaView(cleanQuota({ ...base, consumed: 60500 }, NOW)!, NOW);
  assert.equal(over.exhausted, true);
  assert.equal(over.additionalUsed, 500);
});

test('quota view: reset is the next month start unless the runtime says otherwise', () => {
  assert.equal(nextMonthStart(NOW), Date.UTC(2026, 10, 1));
  assert.equal(nextMonthStart(Date.UTC(2026, 11, 31, 23)), Date.UTC(2027, 0, 1));
  const est = quotaView(cleanQuota(base, NOW)!, NOW);
  assert.equal(est.resetEstimated, true);
  const real = quotaView(cleanQuota({ ...base, resetAt: NOW + 5 * 86400_000 }, NOW)!, NOW);
  assert.equal(real.resetEstimated, false);
  assert.equal(real.resetAt, NOW + 5 * 86400_000);
});
