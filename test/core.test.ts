import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionTracker } from '../src/core/reducer.ts';
import { familyOf, tierOf } from '../src/core/family.ts';
import { redact, truncate } from '../src/core/redact.ts';
import { summarizeTool } from '../src/core/summarize.ts';
import type { RawEvent } from '../src/core/types.ts';

const T0 = Date.parse('2026-10-18T10:00:00.000Z');
let n = 0;
const ev = (type: string, data: any = {}, extra: Partial<RawEvent> = {}, offsetMs = n * 1000): RawEvent => ({
  type,
  data,
  id: `e${++n}`,
  timestamp: new Date(T0 + offsetMs).toISOString(),
  ...extra,
});
const live = { live: true, running: false };

test('family and tier detection', () => {
  assert.equal(familyOf('claude-sonnet-5.5'), 'claude');
  assert.equal(familyOf('gpt-5.3-codex'), 'gpt');
  assert.equal(familyOf('gemini-4-argon'), 'gemini');
  assert.equal(familyOf('grok-4.7'), 'grok');
  assert.equal(familyOf('mai-code-1.1-flash'), 'mai');
  assert.equal(familyOf('something-else'), 'generic');
  assert.equal(familyOf(undefined), 'generic');
  assert.equal(tierOf('claude-opus-5'), 3);
  assert.equal(tierOf('claude-haiku-4.5'), 1);
  assert.equal(tierOf('claude-sonnet-5'), 2);
});

test('redacts secrets and truncates with head and tail', () => {
  const secret = `ghp_${'a'.repeat(30)}`;
  assert.equal(redact(`token ${secret} end`), 'token [redacted] end');
  assert.ok(!redact('Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123').includes('abcdefghij'));
  const long = 'x'.repeat(100) + 'END';
  const out = truncate(long, 40);
  assert.ok(out.includes('hidden') && out.endsWith('END'));
});

test('summarizes tool arguments', () => {
  assert.equal(summarizeTool('powershell', { command: 'npm   test' }), 'npm test');
  assert.equal(summarizeTool('view', { path: 'C:\\a\\b.ts' }), 'C:\\a\\b.ts');
  assert.match(summarizeTool('apply_patch', '*** Begin Patch\n*** Update File: src/x.ts\n'), /src\/x\.ts/);
});

test('idle -> thinking -> tool -> thinking -> idle', () => {
  const t = new SessionTracker('s1');
  t.ingest(ev('session.start', { selectedModel: 'claude-sonnet-5.5' }));
  assert.equal(t.snapshot(T0 + 1000, live).state, 'idle');
  t.ingest(ev('user.message', { content: 'hi' }));
  t.ingest(ev('assistant.turn_start', { turnId: 'a' }));
  assert.equal(t.snapshot(T0 + 5000, live).state, 'thinking');
  t.ingest(ev('tool.execution_start', { toolCallId: 'c1', toolName: 'powershell', arguments: { command: 'npm test' } }));
  const s = t.snapshot(T0 + 6000, live);
  assert.equal(s.state, 'tool');
  assert.equal(s.category, 'shell');
  assert.equal(s.activity, 'npm test');
  t.ingest(ev('tool.execution_complete', { toolCallId: 'c1', success: true, result: { content: 'ok' } }));
  assert.equal(t.snapshot(T0 + 7000, live).state, 'thinking');
  t.ingest(ev('assistant.turn_end', { turnId: 'a' }));
  assert.equal(t.snapshot(T0 + 8000, live).state, 'idle');
  const tool = t.itemsSince(0).find((i) => i.kind === 'tool');
  assert.equal(tool?.status, 'ok');
  assert.ok((tool?.durationMs ?? -1) >= 0);
});

test('permission and ask_user take priority and clear', () => {
  const t = new SessionTracker('s2');
  t.ingest(ev('assistant.turn_start', { turnId: 'a' }));
  t.ingest(ev('permission.requested', { requestId: 'r1', permissionRequest: { kind: 'shell', fullCommandText: 'rm -rf x' } }));
  let s = t.snapshot(T0 + 20_000, live);
  assert.equal(s.state, 'awaiting-permission');
  assert.equal(s.pending?.kind, 'shell');
  t.ingest(ev('permission.completed', { requestId: 'r1', result: { kind: 'approved' } }));
  assert.equal(t.snapshot(T0 + 21_000, live).state, 'thinking');
  t.ingest(ev('tool.execution_start', { toolCallId: 'q', toolName: 'ask_user', arguments: { question: 'Which DB?' } }));
  s = t.snapshot(T0 + 22_000, live);
  assert.equal(s.state, 'awaiting-input');
  assert.equal(s.activity, 'Which DB?');
  t.ingest(ev('tool.execution_complete', { toolCallId: 'q', success: true }));
  assert.notEqual(t.snapshot(T0 + 23_000, live).state, 'awaiting-input');
});

test('abort clears in-flight work', () => {
  const t = new SessionTracker('s3');
  t.ingest(ev('assistant.turn_start', { turnId: 'a' }));
  t.ingest(ev('tool.execution_start', { toolCallId: 'c', toolName: 'view', arguments: { path: 'x' } }));
  t.ingest(ev('abort', { reason: 'user_initiated' }));
  assert.equal(t.snapshot(T0 + 30_000, live).state, 'idle');
});

test('sub-agents are tracked by agentId and drive the task state', () => {
  const t = new SessionTracker('s4');
  t.ingest(ev('assistant.turn_start', { turnId: 'a' }));
  t.ingest(ev('subagent.started', { toolCallId: 'tc', agentName: 'explore', agentDisplayName: 'Explorer', model: 'gpt-6-astra', executionMode: 'background' }, { agentId: 'sub1' }));
  t.ingest(ev('assistant.turn_end', { turnId: 'a' }));
  let s = t.snapshot(T0 + 40_000, live);
  assert.equal(s.state, 'tool');
  assert.equal(s.category, 'task');
  assert.equal(s.subagents[0].family, 'gpt');
  t.ingest(ev('tool.execution_start', { toolCallId: 'x', toolName: 'rg', arguments: { pattern: 'foo' } }, { agentId: 'sub1' }));
  s = t.snapshot(T0 + 41_000, live);
  assert.match(s.activity, /Explorer: search/);
  t.ingest(ev('subagent.completed', { totalToolCalls: 3, totalTokens: 100, durationMs: 5000 }, { agentId: 'sub1' }));
  assert.equal(t.snapshot(T0 + 42_000, live).subagents[0].status, 'done');
});

test('stalled when work is open but nothing is alive', () => {
  const t = new SessionTracker('s5');
  t.ingest(ev('assistant.turn_start', { turnId: 'a' }));
  const dead = { live: false, running: false };
  assert.equal(t.snapshot(T0 + 25 * 60_000, dead).state, 'stalled');
});

test('shutdown without a live process is offline; error shows when nothing else is open', () => {
  const t = new SessionTracker('s6');
  t.ingest(ev('session.error', { message: 'boom' }));
  assert.equal(t.snapshot(T0 + 1000, live).state, 'error');
  t.ingest(ev('session.shutdown', { shutdownType: 'routine' }));
  assert.equal(t.snapshot(T0 + 2000, { live: false, running: false }).state, 'offline');
});

test('screens: feed and focus follow the running tool', () => {
  const t = new SessionTracker('s8');
  t.ingest(ev('user.message', { content: 'do it' }));
  t.ingest(ev('assistant.turn_start', { turnId: 'a' }));
  t.ingest(ev('tool.execution_start', { toolCallId: 'c1', toolName: 'powershell', arguments: { command: 'npm test' } }));
  let s = t.snapshot(T0 + 60_000, live);
  assert.equal(s.focus?.title, 'powershell');
  assert.equal(s.focus?.status, 'running');
  assert.equal(s.feed.at(-1)?.text, 'npm test');
  t.ingest(ev('tool.execution_complete', { toolCallId: 'c1', success: true, result: { content: 'all green' } }));
  s = t.snapshot(T0 + 61_000, live);
  assert.equal(s.focus?.status, 'ok');
  assert.match(s.focus?.text ?? '', /all green/);
  assert.ok(s.feed.length <= 9);
});

test('incremental timeline by revision', () => {
  const t = new SessionTracker('s7');
  t.ingest(ev('user.message', { content: 'one' }));
  const r = t.rev;
  t.ingest(ev('user.message', { content: 'two' }));
  assert.equal(t.itemsSince(r).length, 1);
  assert.equal(t.itemsSince(0).length, 2);
});
