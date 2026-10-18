import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBridge } from '../bridge/core.mjs';
import { describeCommand, validateCommand } from '../bridge/protocol.mjs';
import { ControlServer } from '../src/main/control.ts';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ua-test-'));
process.env.LOCALAPPDATA = path.join(tmp, 'local');
process.env.XDG_DATA_HOME = path.join(tmp, 'local');

type Handler = (ev: any) => void;

function mockSession(id = 'sess-1') {
  const handlers = new Map<string, Handler[]>();
  const calls: any[] = [];
  const session: any = {
    sessionId: id,
    on(type: string, h: Handler) {
      handlers.set(type, [...(handlers.get(type) ?? []), h]);
      return () => {};
    },
    async send(o: any) {
      calls.push(['send', o]);
      return 'msg-1';
    },
    async abort() {
      calls.push(['abort']);
    },
    async setModel(m: string) {
      calls.push(['setModel', m]);
    },
    rpc: {
      ui: {
        async handlePendingUserInput(p: any) {
          calls.push(['input', p]);
          return { success: p.requestId === 'q1' };
        },
      },
      permissions: {
        async handlePendingPermissionRequest(p: any) {
          calls.push(['perm', p]);
          return { success: p.requestId === 'p1' };
        },
      },
    },
  };
  const emit = (type: string, data: any) => (handlers.get(type) ?? []).forEach((h) => h({ type, data }));
  return { session, calls, emit };
}

const noConfig = () => null;

test('validates and describes commands', () => {
  assert.equal(validateCommand({ type: 'send', text: '' }).ok, false);
  assert.equal(validateCommand({ type: 'send', text: 'x'.repeat(20001) }).ok, false);
  assert.equal(validateCommand({ type: 'rm -rf' }).ok, false);
  assert.equal(validateCommand({ type: 'permission', requestId: 'a', decision: 'maybe' }).ok, false);
  assert.equal(validateCommand({ type: 'setModel', model: 'bad model!' }).ok, false);
  const ok = validateCommand({ type: 'send', text: 'hi', interrupt: 'yes' });
  assert.ok(ok.ok && ok.cmd.type === 'send' && ok.cmd.interrupt === false);
  assert.match(describeCommand({ type: 'send', text: 'hello\nworld', interrupt: true }), /interrupt.*hello world/);
});

test('bridge executes commands against the session', async () => {
  const { session, calls } = mockSession();
  const b = createBridge(session, { readConfig: noConfig });
  assert.deepEqual(await b.execute({ type: 'send', text: 'hello' }), { ok: true, detail: 'msg-1' });
  await b.execute({ type: 'send', text: 'now', interrupt: true });
  assert.equal(calls[0][1].mode, 'enqueue');
  assert.equal(calls[1][1].mode, 'immediate');
  assert.equal((await b.execute({ type: 'abort' })).ok, true);
  assert.equal((await b.execute({ type: 'setModel', model: 'gpt-5.4' })).ok, true);
  assert.equal((await b.execute({ type: 'answer', requestId: 'q1', answer: 'yes' })).ok, true);
  const gone = await b.execute({ type: 'answer', requestId: 'zzz', answer: 'yes' });
  assert.equal(gone.ok, false);
  assert.match(gone.error ?? '', /no longer pending/);
  await b.execute({ type: 'permission', requestId: 'p1', decision: 'approve' });
  await b.execute({ type: 'permission', requestId: 'p1', decision: 'reject' });
  assert.deepEqual(calls.filter((c) => c[0] === 'perm').map((c) => c[1].result.kind), ['approve-once', 'reject']);
  assert.equal((await b.execute({ type: 'nope' })).ok, false);
  b.stop();
});

test('bridge tracks what the session is waiting for', () => {
  const { session, emit } = mockSession();
  const b = createBridge(session, { readConfig: noConfig });
  emit('permission.requested', { requestId: 'p1', permissionRequest: { kind: 'shell', fullCommandText: 'git push --force' } });
  emit('user_input.requested', { requestId: 'q1', question: 'Which DB?', choices: ['a', 'b'] });
  let snap = b.snapshot().pending;
  assert.equal(snap.length, 2);
  assert.equal(snap[0].text, 'git push --force');
  assert.deepEqual(snap[1].choices, ['a', 'b']);
  emit('permission.completed', { requestId: 'p1' });
  emit('user_input.completed', { requestId: 'q1' });
  assert.equal(b.snapshot().pending.length, 0);
  emit('permission.requested', { requestId: 'p2', permissionRequest: { kind: 'write', path: 'x' } });
  emit('abort', {});
  assert.equal(b.snapshot().pending.length, 0);
  b.stop();
});

test('end to end: app server <-> bridge, gated by the enable switch, audited and redacted', async () => {
  const home = path.join(tmp, 'copilot-home');
  const source = path.join(tmp, 'bridge-src');
  fs.mkdirSync(source, { recursive: true });
  for (const f of ['extension.mjs', 'core.mjs', 'protocol.mjs']) fs.copyFileSync(path.join('bridge', f), path.join(source, f));
  let changes = 0;
  const server = new ControlServer({ copilotHome: home, bridgeSource: source, onChange: () => changes++ });
  await server.start();

  const cfgFile = path.join(tmp, 'local', 'ur-agents', 'bridge.json');
  const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  assert.equal(typeof cfg.port, 'number');

  // Unauthenticated, wrong-host and browser-origin requests are refused.
  assert.equal((await fetch(`http://127.0.0.1:${cfg.port}/b/hello`, { method: 'POST', body: '{}' })).status, 401);
  assert.equal((await fetch(`http://127.0.0.1:${cfg.port}/b/hello`, { method: 'POST', headers: { authorization: `Bearer ${cfg.token}`, origin: 'http://evil.example' }, body: '{}' })).status, 401);

  const { session, calls, emit } = mockSession('sess-e2e');
  const bridge = createBridge(session, { readConfig: () => cfg, retryMs: 50, idleMs: 50 });
  bridge.start();
  const until = async (fn: () => boolean) => {
    for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 30));
    assert.ok(fn(), 'condition not reached');
  };
  await until(() => server.state().sessions['sess-e2e']?.connected === true);

  // Switched off by default: nothing reaches the session.
  const refused = await server.send('sess-e2e', { type: 'send', text: 'hi' });
  assert.equal(refused.ok, false);
  assert.match(refused.error!, /switched off/);
  assert.equal(calls.length, 0);

  server.setEnabled(true);
  assert.deepEqual(await server.send('sess-e2e', { type: 'send', text: 'hello from the app' }), { ok: true, error: undefined, detail: 'msg-1' });
  assert.equal(calls[0][1].prompt, 'hello from the app');
  assert.equal((await server.send('sess-e2e', { type: 'send', text: '' })).ok, false);
  assert.match((await server.send('nobody', { type: 'abort' })).error!, /no bridge/);

  emit('permission.requested', { requestId: 'p1', permissionRequest: { kind: 'shell', fullCommandText: `curl -H "Authorization: Bearer ${'a'.repeat(40)}" x` } });
  await until(() => (server.state().sessions['sess-e2e']?.pending.length ?? 0) === 1);
  const pend = server.state().sessions['sess-e2e'].pending[0];
  assert.equal(pend.kind, 'permission');
  assert.ok(!pend.text.includes('aaaaaaaaaa'), 'secret must be redacted');
  assert.equal((await server.send('sess-e2e', { type: 'permission', requestId: 'p1', decision: 'approve' })).ok, true);

  const audit = fs.readFileSync(path.join(tmp, 'local', 'ur-agents', 'audit.jsonl'), 'utf8');
  assert.match(audit, /hello from the app/);
  assert.match(audit, /permission p1: approve/);
  assert.match(audit, /control switched on/);

  // Bridge install/uninstall copies the three files and reports state.
  assert.equal(server.state().install, 'none');
  assert.equal(server.install().ok, true);
  assert.equal(server.state().install, 'current');
  assert.ok(fs.existsSync(path.join(home, 'extensions', 'ur-agents-bridge', 'extension.mjs')));
  fs.appendFileSync(path.join(home, 'extensions', 'ur-agents-bridge', 'core.mjs'), '\n// old');
  assert.equal(server.state().install, 'outdated');
  assert.equal(server.uninstall().ok, true);
  assert.equal(server.state().install, 'none');

  bridge.stop();
  server.stop();
  assert.ok(!fs.existsSync(cfgFile), 'bridge.json is removed on stop');
  assert.ok(changes > 0);
});
