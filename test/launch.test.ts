import assert from 'node:assert/strict';
import test from 'node:test';
import { buildArgs, MAX_PROMPT, parseLaunch } from '../src/core/launch.ts';

test('launch: defaults and trimming', () => {
  const r = parseLaunch({ room: 'r1', prompt: '  fix the bug  ' });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.req.prompt, 'fix the bug');
    assert.equal(r.req.mode, 'interactive');
    assert.equal(r.req.access, 'tools');
    assert.equal(r.req.model, undefined);
  }
});

test('launch: rejects bad input', () => {
  assert.equal(parseLaunch(null).ok, false);
  assert.equal(parseLaunch({ room: '', prompt: 'x' }).ok, false);
  assert.equal(parseLaunch({ room: 'r', prompt: '   ' }).ok, false);
  assert.equal(parseLaunch({ room: 'r', prompt: 'x'.repeat(MAX_PROMPT + 1) }).ok, false);
  assert.equal(parseLaunch({ room: 'r', prompt: 'x', model: '--allow-all' }).ok, false);
  assert.equal(parseLaunch({ room: 'r', prompt: 'x', model: 'a b' }).ok, false);
  assert.equal(parseLaunch({ room: 'r', prompt: 'x', mode: 'root' }).ok, false);
  assert.equal(parseLaunch({ room: 'r', prompt: 'x', effort: 'ludicrous' }).ok, false);
  assert.equal(parseLaunch({ room: 'r', prompt: 'x', access: 'everything' }).ok, false);
});

test('launch: arguments never let the prompt or name act as flags', () => {
  const r = parseLaunch({ room: 'r', prompt: '--allow-all rm -rf', model: 'gpt-5.4', mode: 'autopilot', effort: 'high', name: '  my\n task ' });
  assert.ok(r.ok);
  if (!r.ok) return;
  const args = buildArgs(r.req, '11111111-2222-3333-4444-555555555555');
  assert.ok(args.includes('--prompt=--allow-all rm -rf'));
  assert.ok(!args.includes('--allow-all'));
  assert.ok(args.includes('--allow-all-tools'));
  assert.deepEqual(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2), ['--model', 'gpt-5.4']);
  assert.ok(args.includes('--name=my task'));
  assert.equal(args[args.indexOf('--mode') + 1], 'autopilot');
});

test('launch: full access is explicit', () => {
  const r = parseLaunch({ room: 'r', prompt: 'x', access: 'full' });
  assert.ok(r.ok);
  if (r.ok) assert.ok(buildArgs(r.req, 'id').includes('--allow-all'));
});
