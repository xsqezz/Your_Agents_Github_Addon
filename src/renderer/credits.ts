import type { ControlState } from '../core/control.ts';
import { formatCredits, quotaView, type Quota, type QuotaView } from '../core/quota.ts';

type Child = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: { class?: string; text?: string; attrs?: Record<string, string> } = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.text != null) node.textContent = props.text;
  for (const [k, v] of Object.entries(props.attrs ?? {})) node.setAttribute(k, v);
  for (const kid of kids) if (kid) node.append(kid);
  return node;
}

const STALE_MS = 15 * 60_000;
let state: ControlState | null = null;
let sig = '';

function ago(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const hrs = Math.round(m / 60);
  return hrs < 48 ? `${hrs} h ago` : `${Math.round(hrs / 24)} d ago`;
}

const percent = (f: number): string => `${Math.round(f * 1000) / 10}%`;

function bar(v: QuotaView): HTMLElement {
  const total = v.totalLimit || 1;
  const inc = h('i', { class: 'cr-inc' });
  inc.style.width = `${Math.min(100, (v.includedUsed / total) * 100)}%`;
  const add = h('i', { class: 'cr-add' });
  add.style.left = `${(v.includedFraction * 100).toFixed(2)}%`;
  add.style.width = `${Math.min(100 - v.includedFraction * 100, (Math.min(v.additionalUsed, v.additionalLimit || v.additionalUsed) / total) * 100)}%`;
  const track = h('div', { class: 'cr-track', attrs: { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(Math.round(v.totalLimit)), 'aria-valuenow': String(Math.round(v.includedUsed + v.additionalUsed)), 'aria-label': 'AI credits used this month' } }, inc, add);
  if (v.additionalLimit > 0) {
    const tick = h('i', { class: 'cr-tick', attrs: { title: 'End of the included credits; the additional budget follows' } });
    tick.style.left = `${(v.includedFraction * 100).toFixed(2)}%`;
    track.append(tick);
  }
  return track;
}

function card(q: Quota, now: number): HTMLElement {
  const v = quotaView(q, now);
  const reset = new Date(v.resetAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const age = now - q.observedAt;
  const lines: Child[] = [];

  if (v.unlimited) {
    lines.push(h('p', { class: 'cr-main', text: 'Unlimited' }), h('p', { class: 'cr-sub', text: `${formatCredits(q.consumed)} used this month` }));
  } else {
    lines.push(
      h('p', { class: 'cr-main' }, h('b', { text: formatCredits(q.consumed) }), h('span', { text: ` / ${formatCredits(v.totalLimit)} used` })),
      bar(v),
      h('p', { class: 'cr-left', attrs: { 'data-level': v.exhausted ? 'critical' : v.level }, text: v.exhausted ? 'Limit reached' : `${formatCredits(v.remaining)} left · ${percent(v.remaining / (v.totalLimit || 1))}` }),
    );
    if (v.additionalLimit > 0) {
      lines.push(h('p', { class: 'cr-sub', text: `Included ${formatCredits(q.entitlement)} + additional budget ${formatCredits(v.additionalLimit)}` }), h('p', { class: 'cr-sub', text: `Additional used: ${formatCredits(Math.min(v.additionalUsed, v.additionalLimit))} of ${formatCredits(v.additionalLimit)}` }));
    } else {
      lines.push(h('p', { class: 'cr-sub', text: `Included ${formatCredits(q.entitlement)} · no additional budget` }));
    }
  }
  lines.push(h('p', { class: 'cr-sub' }, h('span', { text: `Resets ${v.resetEstimated ? '~' : ''}${reset}` }), h('span', { class: age > STALE_MS ? 'cr-stale' : '', text: ` · updated ${ago(age)}` })));
  return h('div', { class: 'cr-card' }, h('div', { class: 'cr-head' }, h('span', { text: 'AI credits · month' }), q.plan ? h('em', { text: q.plan }) : null), ...lines);
}

function empty(s: ControlState | null): HTMLElement {
  const connected = s ? Object.values(s.sessions).some((x) => x.connected) : false;
  const box = h('div', { class: 'cr-card cr-empty' }, h('div', { class: 'cr-head' }, h('span', { text: 'AI credits · month' })));
  if (!s) box.append(h('p', { class: 'cr-sub', text: 'Connecting…' }));
  else if (!s.demo && s.install !== 'current') {
    box.append(h('p', { class: 'cr-sub', text: 'The limit comes from your Copilot login, which only a session can use. Install the bridge to show it.' }));
    const btn = h('button', { class: 'btn small primary', text: s.install === 'outdated' ? 'Update bridge' : 'Install bridge', attrs: { type: 'button' } });
    btn.addEventListener('click', () => void window.ua.controlInstall());
    box.append(btn);
  } else if (!connected) box.append(h('p', { class: 'cr-sub', text: 'Waiting for a Copilot session to report it. Start a new session in the Copilot app and it shows up here.' }));
  else box.append(h('p', { class: 'cr-sub', text: 'Your plan did not report a credit budget.' }));
  return box;
}

export function renderCredits(): void {
  const root = document.getElementById('credits');
  if (!root) return;
  const now = Date.now();
  const q = state?.quota;
  const next = q ? `${q.consumed}|${q.entitlement}|${q.overage}|${q.overageLimit}|${q.observedAt}|${Math.floor(now / 60_000)}` : `none|${state ? state.install : '-'}|${state ? Object.values(state.sessions).some((x) => x.connected) : '-'}`;
  if (next === sig) return;
  sig = next;
  root.replaceChildren(q ? card(q, now) : empty(state));
}

export function initCredits(): void {
  window.ua.onControl((s) => {
    state = s;
    renderCredits();
  });
  void window.ua.controlState().then((s) => {
    state = s;
    renderCredits();
  });
  setInterval(renderCredits, 30_000);
}
