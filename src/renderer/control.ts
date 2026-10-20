import type { ControlCommand, ControlResult, ControlState, PendingItem } from '../core/control.ts';
import type { SessionSummary } from '../core/types.ts';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

type Child = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: { class?: string; text?: string; attrs?: Record<string, string> } = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.text != null) node.textContent = props.text;
  for (const [k, v] of Object.entries(props.attrs ?? {})) node.setAttribute(k, v);
  for (const kid of kids) if (kid) node.append(kid);
  return node;
}

let state: ControlState | null = null;
let current: () => SessionSummary | undefined = () => undefined;
let statusTimer: number | undefined;
let pendingSig = '';
let busy = false;
const isCodexApiSession = (id: string): boolean => id.startsWith('codex-api:') || id.startsWith('work:');

export function controlState(): ControlState | null {
  return state;
}

export function setControlState(s: ControlState): void {
  state = s;
  renderControl();
}

function flash(text: string, error = false): void {
  const el = $('ctl-status');
  el.textContent = text;
  el.dataset.error = error ? '1' : '0';
  window.clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => (el.textContent = ''), 5000);
}

async function run(command: ControlCommand, okText: string): Promise<boolean> {
  const s = current();
  if (!s || busy) return false;
  busy = true;
  setBusy(true);
  try {
    const r = isCodexApiSession(s.id)
      ? command.type === 'send' ? await window.ua.codexApiSend(s.id, command.text)
        : command.type === 'abort' ? await window.ua.codexApiCancel(s.id)
          : { ok: false, error: 'This action is not available for Codex API tasks.' }
      : await window.ua.controlSend(s.id, command);
    flash(r.ok ? okText : (r.error ?? 'Failed'), !r.ok);
    return r.ok;
  } catch {
    flash('Could not reach the app backend', true);
    return false;
  } finally {
    busy = false;
    setBusy(false);
  }
}

function setBusy(on: boolean): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>('#composer button')) if (on) b.disabled = true;
  if (!on) renderControl(true);
}

type Readiness = { ok: true } | { ok: false; notice: string; action?: { label: string; run: () => void } };

function readiness(s: SessionSummary): Readiness {
  if (isCodexApiSession(s.id)) return { ok: true };
  if (s.provider === 'codex') return { ok: false, notice: 'Codex threads are read-only here. Open the thread in the ChatGPT app to send messages, stop work or handle approvals.' };
  if (!state) return { ok: false, notice: 'Connecting to the control service…' };
  if (!state.demo && state.install !== 'current') {
    const outdated = state.install === 'outdated';
    return {
      ok: false,
      notice: outdated
        ? 'The bridge in your Copilot extensions is out of date. Update it to keep control working.'
        : 'To talk to agents from here, ur-agents needs its small bridge extension in your Copilot sessions.',
      action: {
        label: outdated ? 'Update bridge' : 'Install bridge',
        run: () => {
          if (!confirm(`Copy the ur-agents bridge into:\n${state!.installDir}\n\nIt is loaded by new or reloaded Copilot sessions and only talks to this app on your own computer.`)) return;
          void window.ua.controlInstall().then((r) => flash(r.ok ? 'Bridge installed' : (r.error ?? 'Install failed'), !r.ok));
        },
      },
    };
  }
  if (!state.enabled) {
    return { ok: false, notice: 'Control is off. Turn it on to message, stop and answer this agent from here.', action: { label: 'Turn on control', run: () => requestEnable() } };
  }
  if (!state.sessions[s.id]?.connected) {
    return { ok: false, notice: 'This session has no bridge yet. New sessions get it automatically; a running one needs its extensions reloaded (for example /clear in the CLI) or a restart.' };
  }
  return { ok: true };
}

export function requestEnable(): void {
  if (!confirm('Allow ur-agents to send messages, stop agents and answer or approve their requests in your Copilot sessions?\n\nEvery command is written to a local audit log. You can switch this off at any time.')) {
    renderControl(true);
    return;
  }
  void window.ua.controlSetEnabled(true);
}

function card(s: SessionSummary, p: PendingItem): HTMLElement {
  if (p.kind === 'permission') {
    return h('section', { class: 'pcard', attrs: { 'data-kind': 'permission' } },
      h('h3', { text: `Permission needed${p.label ? ` · ${p.label}` : ''}` }),
      h('pre', { class: 'pcmd', text: p.text || '(no details)' }),
      h('div', { class: 'prow' },
        button('Reject', 'btn small', () => void run({ type: 'permission', requestId: p.requestId, decision: 'reject' }, 'Rejected')),
        button('Approve once', 'btn small primary', () => void run({ type: 'permission', requestId: p.requestId, decision: 'approve' }, 'Approved'))));
  }
  const input = h('input', { class: 'pinput', attrs: { type: 'text', placeholder: 'Type an answer…', 'aria-label': 'Answer', maxlength: '20000' } });
  const answerFree = (): void => {
    const v = input.value.trim();
    if (v) void run({ type: 'answer', requestId: p.requestId, answer: v, freeform: true }, 'Answered');
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      answerFree();
    }
  });
  return h('section', { class: 'pcard', attrs: { 'data-kind': 'input' } },
    h('h3', { text: 'Question for you' }),
    h('p', { class: 'pq', text: p.text }),
    (p.choices ?? []).length > 0 && h('div', { class: 'prow wrap' }, ...(p.choices ?? []).map((c) => button(c, 'btn small', () => void run({ type: 'answer', requestId: p.requestId, answer: c, freeform: false }, 'Answered')))),
    p.allowFreeform !== false && h('div', { class: 'prow' }, input, button('Answer', 'btn small primary', answerFree)));
}

function button(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = h('button', { class: cls, text: label, attrs: { type: 'button' } });
  b.addEventListener('click', onClick);
  return b;
}

export function renderControl(force = false): void {
  const s = current();
  const composer = $('composer');
  composer.hidden = !s;

  const toggle = $<HTMLInputElement>('control-toggle');
  toggle.checked = !!state?.enabled;
  toggle.disabled = !state;
  if (!s) return;

  const ready = readiness(s);
  const notice = $('ctl-notice');
  const msg = $<HTMLTextAreaElement>('msg');
  const interrupt = $<HTMLInputElement>('interrupt');
  const send = $<HTMLButtonElement>('send-btn');
  const stop = $<HTMLButtonElement>('stop-btn');
  const interruptLabel = $('interrupt').closest<HTMLElement>('.toggle');
  const live = ready.ok;
  msg.disabled = !live;
  interrupt.disabled = !live;
  send.disabled = !live || busy;
  const apiTask = isCodexApiSession(s.id);
  stop.disabled = !live || busy || (apiTask && !['thinking', 'tool', 'awaiting-input', 'awaiting-permission'].includes(s.state));
  msg.placeholder = live ? apiTask ? 'Message this Codex API task…  (Enter to send, Shift+Enter for a new line)' : 'Message this agent…  (Enter to send, Shift+Enter for a new line)' : 'Control is not available for this agent';
  if (interruptLabel) interruptLabel.hidden = apiTask;
  stop.textContent = apiTask ? 'Cancel turn' : 'Stop';
  composer.dataset.ready = live ? '1' : '0';

  const noticeSig = live ? '' : `${ready.notice}|${ready.action?.label ?? ''}`;
  if (force || notice.dataset.sig !== noticeSig) {
    notice.dataset.sig = noticeSig;
    notice.replaceChildren();
    if (!ready.ok) {
      notice.append(h('p', { text: ready.notice }));
      if (ready.action) notice.append(button(ready.action.label, 'btn small primary', ready.action.run));
    }
    notice.hidden = ready.ok;
  }

  const pending = live ? (state?.sessions[s.id]?.pending ?? []) : [];
  const sig = `${s.id}|${pending.map((p) => p.requestId).join(',')}`;
  if (force || sig !== pendingSig) {
    pendingSig = sig;
    $('pending').replaceChildren(...pending.map((p) => card(s, p)));
  }
}

export function initControl(getCurrent: () => SessionSummary | undefined): void {
  current = getCurrent;
  $<HTMLInputElement>('control-toggle').addEventListener('change', (e) => {
    const on = (e.target as HTMLInputElement).checked;
    if (on) requestEnable();
    else void window.ua.controlSetEnabled(false);
  });

  const form = $<HTMLFormElement>('send-form');
  const msg = $<HTMLTextAreaElement>('msg');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = msg.value.trim();
    if (!text) return;
    const ok = await run({ type: 'send', text, interrupt: $<HTMLInputElement>('interrupt').checked }, 'Sent');
    if (ok) msg.value = '';
  });
  msg.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  $('stop-btn').addEventListener('click', () => {
    if (confirm('Stop this agent’s current work?')) void run({ type: 'abort' }, 'Stopped');
  });

  window.ua.onControl((s) => setControlState(s));
  void window.ua.controlState().then(setControlState);
}
