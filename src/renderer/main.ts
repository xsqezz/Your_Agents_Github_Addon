import { FAMILY_LABEL } from '../core/family.ts';
import type { AgentState, SessionDetail, SessionSummary, TimelineItem } from '../core/types.ts';
import { OfficeScene } from './scene.ts';
import { capacityFor } from './layout.ts';
import { ago, duration, isOccupied, NEEDS_YOU, STATE_COLOR, STATE_ICON, STATE_LABEL, stateText } from './theme.ts';

declare global {
  interface Window {
    ua: {
      info(): Promise<{ mode: 'live' | 'demo'; home: string }>;
      list(): Promise<SessionSummary[]>;
      detail(id: string, since: number): Promise<SessionDetail | null>;
      onSummaries(cb: (list: SessionSummary[]) => void): void;
      onFocus(cb: (id: string) => void): void;
    };
  }
}

type Child = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: { class?: string; text?: string; attrs?: Record<string, string> } = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.text != null) node.textContent = props.text;
  for (const [k, v] of Object.entries(props.attrs ?? {})) node.setAttribute(k, v);
  for (const kid of kids) if (kid) node.append(kid);
  return node;
}
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const params = new URLSearchParams(location.search);
const store = {
  all: [] as SessionSummary[],
  selectedId: null as string | null,
  view: (params.get('view') ?? localStorage.getItem('ua.view') ?? '3d') as '3d' | 'list',
  showOffline: localStorage.getItem('ua.offline') === '1',
  tab: 'live' as 'live' | 'info',
  follow: true,
  since: 0,
  mode: 'live' as 'live' | 'demo',
  home: '',
};

const stage = $('stage');
const panel = $('panel');
const listView = $('list-view');
const emptyEl = $('empty');
const live = $('live');
let scene: OfficeScene;
let announcedStates = new Map<string, AgentState>();
let primed = false;

function visible(): SessionSummary[] {
  return store.showOffline ? store.all : store.all.filter((s) => s.state !== 'offline');
}
const selected = (): SessionSummary | undefined => store.all.find((s) => s.id === store.selectedId);
const panelPx = (): number => (store.selectedId ? Math.min(440, Math.round(window.innerWidth * 0.46)) : 0);

/* ───────────── top bar ───────────── */

function renderTopbar(): void {
  const all = store.all;
  const n = (f: (s: SessionSummary) => boolean) => all.filter(f).length;
  const chips: [string, string, number, AgentState][] = [
    ['Need you', 'awaiting-input', n((s) => NEEDS_YOU.includes(s.state)), 'awaiting-input'],
    ['Working', 'tool', n((s) => s.state === 'tool' || s.state === 'thinking' || s.state === 'compacting'), 'tool'],
    ['Idle', 'idle', n((s) => s.state === 'idle' || s.state === 'done'), 'idle'],
    ['Offline', 'offline', n((s) => s.state === 'offline' || s.state === 'stalled'), 'offline'],
  ];
  const box = $('counts');
  box.replaceChildren(
    ...chips.map(([label, , count, st]) => {
      const chip = h('span', { class: 'chip', attrs: { 'data-zero': count === 0 ? '1' : '0' } });
      const dot = h('i', { class: 'dot' });
      dot.style.background = STATE_COLOR[st];
      chip.append(dot, h('b', { text: String(count) }), h('span', { text: label }));
      return chip;
    }),
  );
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === store.view));
  ($('show-offline') as HTMLInputElement).checked = store.showOffline;
  $('overview').hidden = store.view !== '3d';
}

function renderStatus(): void {
  const bar = $('statusbar');
  const vis = visible();
  const occupied = vis.filter((s) => isOccupied(s.state)).length;
  const desks = capacityFor(vis.length);
  const text = store.mode === 'demo' ? 'Demo — synthetic agents, nothing is read from disk' : `Read-only · watching ${store.home}`;
  bar.replaceChildren(
    h('span', { class: 'live-dot' }),
    h('span', { text }),
    h('span', { class: 'spacer' }),
    h('span', { text: `${occupied} of ${desks} desks occupied` }),
  );
}

/* ───────────── list view ───────────── */

function renderList(): void {
  if (store.view !== 'list') return;
  const rows = visible();
  const head = h('thead', {}, h('tr', {}, ...['State', 'Agent', 'Model', 'Doing now', 'Context', 'Cost', 'Active'].map((t) => h('th', { text: t, attrs: { scope: 'col' } }))));
  const body = h('tbody');
  const now = Date.now();
  for (const s of rows) {
    const state = h('td', { class: 'c-state' });
    const dot = h('i', { class: 'dot' });
    dot.style.background = STATE_COLOR[s.state];
    state.append(dot, h('span', { text: stateText(s) }));
    const name = h('td', { class: 'c-name' });
    const btn = h('button', { class: 'row-open', text: s.title, attrs: { type: 'button', 'data-id': s.id } });
    name.append(btn, h('span', { class: 'sub', text: [s.project, s.branch].filter(Boolean).join(' · ') }));
    const ctx = h('td', { class: 'c-ctx' });
    if (s.contextPct != null) {
      const bar = h('span', { class: 'bar' }, h('i'));
      (bar.firstChild as HTMLElement).style.width = `${Math.round(s.contextPct * 100)}%`;
      ctx.append(bar, h('span', { text: `${Math.round(s.contextPct * 100)}%` }));
    } else ctx.textContent = '–';
    const tr = h('tr', { attrs: { 'data-state': s.state } },
      state, name,
      h('td', { text: `${FAMILY_LABEL[s.family]} · ${s.model || '?'}` }),
      h('td', { class: 'c-act', text: s.state === 'offline' ? '' : s.activity }),
      ctx,
      h('td', { text: s.costAiu != null ? `${s.costAiu.toFixed(1)} AIU` : '–' }),
      h('td', { text: s.lastEventAt ? ago(s.lastEventAt, now) : '–' }));
    if (s.id === store.selectedId) tr.classList.add('is-selected');
    body.append(tr);
  }
  const table = h('table', { class: 'list', attrs: { 'aria-label': 'Agents' } }, head, body);
  listView.replaceChildren(table);
}

/* ───────────── panel ───────────── */

const timelineEls = new Map<string, HTMLElement>();
let timelineBox: HTMLOListElement | null = null;

function glyph(it: TimelineItem): string {
  if (it.kind === 'tool') return { shell: '>_', read: '◎', write: '✎', web: '◍', task: '⧉', input: '?', other: '⚙' }[it.category ?? 'other'];
  return { user: '›', assistant: '◆', permission: '!', subagent: '⧉', system: '•', tool: '⚙' }[it.kind];
}

function statusText(it: TimelineItem): string {
  if (it.status === 'running') return 'running…';
  if (it.status === 'pending') return 'waiting';
  const d = it.durationMs != null ? duration(it.durationMs) : '';
  if (it.status === 'fail') return d ? `failed · ${d}` : 'failed';
  return d;
}

function itemEl(it: TimelineItem): HTMLElement {
  const li = h('li', { class: 'it' });
  const head = h('button', { class: 'it-head', attrs: { type: 'button', 'aria-expanded': 'false' } });
  head.append(
    h('span', { class: 'g', text: glyph(it), attrs: { 'aria-hidden': 'true' } }),
    h('span', { class: 'ti', text: it.title }),
    h('span', { class: 'st', text: statusText(it) }),
    h('time', { class: 'tm', text: new Date(it.ts).toLocaleTimeString([], { hour12: false }) }),
  );
  li.append(head);
  if (it.body) li.append(h('pre', { class: 'it-body', text: it.body }));
  li.dataset.kind = it.kind;
  li.dataset.status = it.status ?? '';
  head.addEventListener('click', () => {
    const open = li.classList.toggle('open');
    head.setAttribute('aria-expanded', String(open));
  });
  return li;
}

function mergeItems(items: TimelineItem[]): void {
  if (!timelineBox) return;
  const box = timelineBox.parentElement!;
  const stick = store.follow;
  for (const it of items) {
    const old = timelineEls.get(it.id);
    const fresh = itemEl(it);
    if (old) {
      if (old.classList.contains('open')) {
        fresh.classList.add('open');
        fresh.querySelector('.it-head')?.setAttribute('aria-expanded', 'true');
      }
      old.replaceWith(fresh);
    } else timelineBox.append(fresh);
    timelineEls.set(it.id, fresh);
  }
  while (timelineBox.children.length > 600) timelineBox.firstElementChild?.remove();
  if (items.length && stick) box.scrollTop = box.scrollHeight;
}

function renderPanel(): void {
  const s = selected();
  panel.hidden = !s;
  document.body.classList.toggle('has-panel', !!s);
  if (!s) return;

  const head = $('panel-head');
  const dot = h('i', { class: 'dot' });
  dot.style.background = STATE_COLOR[s.state];
  head.replaceChildren(
    h('div', { class: 'ph-row' },
      h('h2', { text: s.title }),
      h('button', { class: 'icon-btn', text: '✕', attrs: { type: 'button', id: 'panel-close', 'aria-label': 'Close panel (Esc)' } })),
    h('div', { class: 'ph-state', attrs: { 'data-state': s.state } },
      dot, h('b', { text: `${STATE_ICON[s.state]} ${stateText(s)}` }), h('span', { text: s.state === 'offline' ? '' : s.activity })),
    h('div', { class: 'ph-sub', text: [FAMILY_LABEL[s.family], s.model, s.mode, s.project, s.branch].filter(Boolean).join(' · ') }),
  );

  for (const b of panel.querySelectorAll<HTMLButtonElement>('[role=tab]')) {
    const on = b.dataset.tab === store.tab;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  }
  $('tab-live').hidden = store.tab !== 'live';
  $('tab-info').hidden = store.tab !== 'info';
  $('follow-btn').setAttribute('aria-pressed', String(store.follow));
  if (store.tab === 'info') renderInfo(s);
}

function kv(k: string, v: Child): HTMLElement[] {
  return [h('dt', { text: k }), h('dd', {}, v)];
}

function renderInfo(s: SessionSummary): void {
  const now = Date.now();
  const ctx = h('span', { class: 'ctxline' });
  if (s.contextPct != null) {
    const bar = h('span', { class: 'bar wide' }, h('i'));
    (bar.firstChild as HTMLElement).style.width = `${Math.round(s.contextPct * 100)}%`;
    ctx.append(bar, h('span', { text: `${Math.round(s.contextPct * 100)}% · ${(s.contextTokens ?? 0).toLocaleString()} / ${(s.contextLimit ?? 0).toLocaleString()} tokens` }));
  } else ctx.textContent = 'unknown';

  const subs = h('ul', { class: 'subs' });
  for (const a of s.subagents.slice().reverse()) {
    subs.append(h('li', { text: `${a.displayName} · ${FAMILY_LABEL[a.family]} ${a.model} · ${a.status}${a.toolCalls != null ? ` · ${a.toolCalls} tool calls` : ''}` }));
  }

  const copy = h('button', { class: 'link-btn', text: 'Copy', attrs: { type: 'button' } });
  copy.addEventListener('click', () => void navigator.clipboard?.writeText(s.id));

  const dl = h('dl', { class: 'kv' },
    ...kv('Status', `${stateText(s)}${s.state === 'offline' ? '' : ` since ${ago(s.stateSince, now)} ago`}`),
    ...kv('Doing', s.activity || '–'),
    ...kv('Model', `${s.model || 'unknown'} (${FAMILY_LABEL[s.family]})`),
    ...kv('Mode', s.mode ?? '–'),
    ...kv('Context', ctx),
    ...kv('Cost', s.costAiu != null ? `${s.costAiu.toFixed(2)} AIU${s.premiumRequests != null ? ` · ${s.premiumRequests} premium requests` : ''}` : '–'),
    ...kv('Activity', `${s.toolCalls} tool calls · ${s.turns} turns · ${s.hooks} hook runs`),
    ...kv('Last event', s.lastEventAt ? `${ago(s.lastEventAt, now)} ago` : '–'),
    ...kv('Sub-agents', s.subagents.length ? subs : 'none'),
    ...kv('Process', s.live ? 'running' : 'not running'),
    ...kv('Session', h('span', { class: 'idline' }, h('code', { text: s.id }), copy)),
  );

  $('tab-info').replaceChildren(
    dl,
    h('section', { class: 'note' },
      h('h3', { text: 'Controls' }),
      h('p', { text: 'Sending messages, stopping an agent and answering or approving requests need the bridge extension. Not installed yet — this version only watches.' })),
  );
}

let pollBusy = false;
async function pollDetail(): Promise<void> {
  const id = store.selectedId;
  if (!id || store.tab !== 'live' || pollBusy) return;
  pollBusy = true;
  try {
    const d = await window.ua.detail(id, store.since);
    if (d && store.selectedId === id) {
      store.since = d.rev;
      mergeItems(d.items);
      $('src').textContent = d.source ? 'live from events.jsonl' : 'no event log for this session';
    }
  } finally {
    pollBusy = false;
  }
}

/* ───────────── selection & wiring ───────────── */

function select(id: string | null): void {
  if (id === store.selectedId) return;
  store.selectedId = id;
  store.since = 0;
  store.follow = true;
  timelineEls.clear();
  timelineBox = $('timeline') as HTMLOListElement;
  timelineBox.replaceChildren();
  scene.setSelected(id, panelPx());
  renderPanel();
  renderList();
  if (id) void pollDetail();
}

function render(): void {
  renderTopbar();
  renderStatus();
  const vis = visible();
  scene.setSessions(vis);
  emptyEl.hidden = vis.length > 0 || store.view !== '3d';
  if (!vis.length) {
    const hidden = store.all.length;
    emptyEl.querySelector('p')!.textContent = hidden
      ? `${hidden} recent session${hidden > 1 ? 's are' : ' is'} offline. Turn on “Show offline” to see them.`
      : 'Start an agent in the GitHub Copilot app and it takes a desk here. Run with --demo to preview the hall.';
  }
  if (store.selectedId && !vis.find((s) => s.id === store.selectedId)) select(null);
  renderPanel();
  renderList();
  stage.hidden = store.view !== '3d';
  listView.hidden = store.view !== 'list';
}

function announce(list: SessionSummary[]): void {
  for (const s of list) {
    const prev = announcedStates.get(s.id);
    announcedStates.set(s.id, s.state);
    if (primed && prev !== s.state && NEEDS_YOU.includes(s.state)) {
      live.textContent = `${s.title}: ${STATE_LABEL[s.state]}`;
    }
  }
  primed = true;
}

function cycle(dir: number): void {
  const vis = visible();
  if (!vis.length) return;
  const i = vis.findIndex((s) => s.id === store.selectedId);
  const next = i < 0 ? (dir > 0 ? 0 : vis.length - 1) : (i + dir + vis.length) % vis.length;
  select(vis[next].id);
}

function boot(): void {
  scene = new OfficeScene(stage, { onSelect: select });

  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const open = t.closest<HTMLElement>('.row-open');
    if (open?.dataset.id) select(open.dataset.id);
    if (t.closest('#panel-close')) select(null);
    const view = t.closest<HTMLElement>('[data-view]');
    if (view) {
      store.view = view.dataset.view as '3d' | 'list';
      localStorage.setItem('ua.view', store.view);
      render();
    }
    const tab = t.closest<HTMLElement>('[role=tab]');
    if (tab) {
      store.tab = tab.dataset.tab as 'live' | 'info';
      renderPanel();
      if (store.tab === 'live') void pollDetail();
    }
    if (t.closest('#follow-btn')) {
      store.follow = !store.follow;
      $('follow-btn').setAttribute('aria-pressed', String(store.follow));
      if (store.follow) $('tab-live').scrollTop = $('tab-live').scrollHeight;
    }
    if (t.closest('#overview')) scene.frameAll(true);
  });
  $('show-offline').addEventListener('change', (e) => {
    store.showOffline = (e.target as HTMLInputElement).checked;
    localStorage.setItem('ua.offline', store.showOffline ? '1' : '0');
    render();
  });
  $('tab-live').addEventListener('scroll', () => {
    const el = $('tab-live');
    const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (!atEnd && store.follow) {
      store.follow = false;
      $('follow-btn').setAttribute('aria-pressed', 'false');
    }
  });
  window.addEventListener('keydown', (e) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === 'Escape') select(null);
    else if (e.key === 'ArrowRight') cycle(1);
    else if (e.key === 'ArrowLeft') cycle(-1);
  });
  window.addEventListener('resize', () => scene.setSelected(store.selectedId, panelPx()));

  window.ua.onSummaries((list) => {
    store.all = list;
    announce(list);
    render();
  });
  window.ua.onFocus((id) => select(id));
  setInterval(() => void pollDetail(), 600);
  setInterval(() => {
    if (store.view === 'list') renderList();
    if (store.selectedId && store.tab === 'info') renderPanel();
  }, 1000);
}

async function start(): Promise<void> {
  boot();
  const info = await window.ua.info();
  store.mode = info.mode;
  store.home = info.home;
  store.all = await window.ua.list();
  announce(store.all);
  render();
  const sel = params.get('select');
  if (sel !== null) {
    const vis = visible();
    const pick = vis[Number(sel)] ?? vis[0];
    if (pick) select(pick.id);
  }
}

void start();
