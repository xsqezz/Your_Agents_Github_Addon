import { PROTOCOL_VERSION, reduceQuota, validateCommand } from './protocol.mjs';

const sleep = (ms, signal) =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });

function describePermission(req) {
  const r = req && typeof req === 'object' ? req : {};
  const text = r.fullCommandText ?? r.command ?? r.path ?? r.fileName ?? r.url ?? r.toolName ?? r.intention ?? r.title ?? '';
  return String(text).slice(0, 4000);
}

/**
 * The bridge: runs inside one Copilot CLI session, reports what the session is waiting for, and executes the
 * commands the ur-agents app sends. It never changes the session's own permission or input handling: it only
 * answers requests the user has explicitly chosen in the app.
 *
 * `readConfig()` returns { port, token } while the app is running, otherwise null.
 */
export function createBridge(session, { readConfig, fetchImpl = globalThis.fetch, log = () => {}, retryMs = 4000, idleMs = 5000, pollTimeoutMs = 40000, quotaMs = 120000 }) {
  const permissions = new Map();
  const inputs = new Map();
  let stopped = false;
  let pushTimer = null;
  let quotaTimer = null;
  let current = null;
  const ac = new AbortController();

  const snapshot = () => ({
    pending: [
      ...[...permissions.values()].map((p) => ({ kind: 'permission', requestId: p.requestId, label: p.label, text: p.text })),
      ...[...inputs.values()].map((p) => ({ kind: 'input', requestId: p.requestId, text: p.text, choices: p.choices, allowFreeform: p.allowFreeform })),
    ],
  });

  const headers = (cfg) => ({ authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' });
  const url = (cfg, p) => `http://127.0.0.1:${cfg.port}${p}`;
  const post = (cfg, p, body, timeout = 8000) =>
    fetchImpl(url(cfg, p), { method: 'POST', headers: headers(cfg), body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });

  function changed() {
    if (!current || pushTimer) return;
    pushTimer = setTimeout(() => {
      pushTimer = null;
      if (current) post(current, '/b/state', { sessionId: session.sessionId, ...snapshot() }).catch(() => {});
    }, 80);
  }

  const offs = [
    session.on('permission.requested', (ev) => {
      const d = ev?.data ?? {};
      if (!d.requestId) return;
      permissions.set(d.requestId, { requestId: d.requestId, label: String(d.permissionRequest?.kind ?? 'permission'), text: describePermission(d.permissionRequest) });
      changed();
    }),
    session.on('permission.completed', (ev) => {
      if (permissions.delete(ev?.data?.requestId)) changed();
    }),
    session.on('user_input.requested', (ev) => {
      const d = ev?.data ?? {};
      if (!d.requestId) return;
      inputs.set(d.requestId, {
        requestId: d.requestId,
        text: String(d.question ?? '').slice(0, 4000),
        choices: Array.isArray(d.choices) ? d.choices.map((c) => String(c).slice(0, 300)).slice(0, 20) : undefined,
        allowFreeform: d.allowFreeform !== false,
      });
      changed();
    }),
    session.on('user_input.completed', (ev) => {
      if (inputs.delete(ev?.data?.requestId)) changed();
    }),
    session.on('abort', () => {
      permissions.clear();
      inputs.clear();
      changed();
    }),
  ];

  async function execute(raw) {
    const v = validateCommand(raw);
    if (!v.ok) return { ok: false, error: v.error };
    const cmd = v.cmd;
    try {
      switch (cmd.type) {
        case 'send': {
          const messageId = await session.send({ prompt: cmd.text, mode: cmd.interrupt ? 'immediate' : 'enqueue' });
          return { ok: true, detail: typeof messageId === 'string' ? messageId : undefined };
        }
        case 'abort':
          await session.abort();
          return { ok: true };
        case 'answer': {
          if (typeof session.rpc?.ui?.handlePendingUserInput !== 'function') return { ok: false, error: 'this Copilot version cannot answer from outside' };
          const r = await session.rpc.ui.handlePendingUserInput({ requestId: cmd.requestId, response: { answer: cmd.answer, wasFreeform: cmd.freeform } });
          return r?.success ? { ok: true } : { ok: false, error: 'the question is no longer pending (answered elsewhere?)' };
        }
        case 'permission': {
          if (typeof session.rpc?.permissions?.handlePendingPermissionRequest !== 'function') return { ok: false, error: 'this Copilot version cannot decide permissions from outside' };
          const result = cmd.decision === 'approve' ? { kind: 'approve-once' } : { kind: 'reject' };
          const r = await session.rpc.permissions.handlePendingPermissionRequest({ requestId: cmd.requestId, result });
          return r?.success ? { ok: true } : { ok: false, error: 'the request is no longer pending (decided elsewhere?)' };
        }
        case 'setModel':
          await session.setModel(cmd.model);
          return { ok: true };
      }
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e).slice(0, 300) };
    }
    return { ok: false, error: 'unsupported' };
  }

  /** The account's AI-credit budget is read through this session's own login and handed to the app. */
  async function pushQuota() {
    const cfg = current;
    if (!cfg || typeof session.rpc?.quota?.get !== 'function') return;
    try {
      const quota = reduceQuota(await session.rpc.quota.get());
      if (quota) await post(cfg, '/b/quota', { sessionId: session.sessionId, quota });
    } catch (e) {
      log(`bridge: quota ${e?.message ?? e}`);
    }
  }

  async function run() {
    while (!stopped) {
      const cfg = readConfig();
      if (!cfg) {
        current = null;
        await sleep(idleMs, ac.signal);
        continue;
      }
      try {
        const hello = await post(cfg, '/b/hello', { sessionId: session.sessionId, protocol: PROTOCOL_VERSION, ...snapshot() });
        if (!hello.ok) throw new Error(`hello ${hello.status}`);
        current = cfg;
        void pushQuota();
        while (!stopped) {
          const r = await fetchImpl(url(cfg, `/b/poll?sid=${encodeURIComponent(session.sessionId)}`), { headers: headers(cfg), signal: AbortSignal.timeout(pollTimeoutMs) });
          if (r.status === 204) continue;
          if (!r.ok) throw new Error(`poll ${r.status}`);
          const { id, command } = await r.json();
          const result = await execute(command);
          await post(cfg, '/b/result', { sessionId: session.sessionId, id, ...result });
        }
      } catch (e) {
        log(`bridge: ${e?.message ?? e}`);
        current = null;
        if (!stopped) await sleep(retryMs, ac.signal);
      }
    }
  }

  return {
    start() {
      void run();
      // Jittered so sessions started together do not all ask GitHub at once.
      quotaTimer = setInterval(() => void pushQuota(), quotaMs + Math.floor(Math.random() * 20000));
      quotaTimer.unref?.();
    },
    stop() {
      stopped = true;
      ac.abort();
      if (pushTimer) clearTimeout(pushTimer);
      if (quotaTimer) clearInterval(quotaTimer);
      for (const off of offs) if (typeof off === 'function') off();
    },
    execute,
    snapshot,
  };
}
