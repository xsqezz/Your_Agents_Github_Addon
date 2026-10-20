import { FAMILY_LABEL } from '../core/family.ts';
import type { AgentProvider, AgentState, RoomInfo, SessionDetail, SessionSummary, Snapshot, TimelineItem } from '../core/types.ts';
import { PROVIDERS } from '../core/providers.ts';
import type { ControlCommand, ControlResult, ControlState } from '../core/control.ts';
import type { LaunchResult } from '../core/launch.ts';
import { initControl, renderControl } from './control.ts';
import { initCredits } from './credits.ts';
import { initLauncher, openLauncher, renderLauncher, toast } from './launch.ts';
import { OfficeScene } from './scene.ts';
import { MIN_DESKS } from './layout.ts';
import { providerFromClickTarget } from './provider-selection.ts';
import { ago, duration, NEEDS_YOU, STATE_COLOR, STATE_ICON, STATE_LABEL, stateText } from './theme.ts';

declare global {
  interface Window {
    ua: {
      info(): Promise<{ mode: 'live' | 'demo'; home: string; providerKeys?: AgentProvider[] }>;
      list(): Promise<Snapshot>;
      detail(id: string, since: number): Promise<SessionDetail | null>;
      onSummaries(cb: (snapshot: Snapshot) => void): void;
      onFocus(cb: (id: string) => void): void;
      controlState(): Promise<ControlState>;
      controlSetEnabled(on: boolean): Promise<void>;
      controlInstall(): Promise<ControlResult>;
      controlUninstall(): Promise<ControlResult>;
      controlSend(id: string, command: ControlCommand): Promise<ControlResult>;
      launch(request: unknown): Promise<LaunchResult>;
      signIn(): Promise<LaunchResult>;
      openInCopilot(sessionId: string): Promise<{ ok: boolean; error?: string }>;
      openInCodex(sessionId: string): Promise<{ ok: boolean; error?: string }>;
      openProviderApp(provider: AgentProvider): Promise<{ ok: boolean; error?: string }>;
      winAction(action: 'minimize' | 'maximize' | 'close'): void;
      winResize(edge: string | null): void;
      onWinState(cb: (state: { maximized: boolean; fullscreen: boolean }) => void): void;
      onControl(cb: (state: ControlState) => void): void;
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
const CODEX_ALL_ROOM = 'codex:all';
type ProviderKey = AgentProvider;
const providerKey = (value: string | null): ProviderKey | null => value && Object.prototype.hasOwnProperty.call(PROVIDERS, value) ? value as ProviderKey : null;
const activeProvider: ProviderKey = providerKey(params.get('provider')) ?? (params.get('room')?.startsWith('codex:') ? 'codex' : null) ?? providerKey(localStorage.getItem('ua.provider')) ?? 'copilot';
const initialRoom = params.get('room') ?? localStorage.getItem(`ua.room.${activeProvider}`) ?? (activeProvider === 'copilot' ? localStorage.getItem('ua.room') : null) ?? '';
const initialView = params.get('view') ?? localStorage.getItem(`ua.view.${activeProvider}`) ?? (activeProvider === 'codex' ? 'list' : localStorage.getItem('ua.view') ?? '3d');
type SidebarView = 'rooms' | 'chats';
let sidebarView: SidebarView = activeProvider === 'codex' && localStorage.getItem('ua.sidebar.codex') !== 'rooms' ? 'chats' : 'rooms';
const store = {
  all: [] as SessionSummary[],
  rooms: [] as RoomInfo[],
  room: initialRoom,
  roomPinned: params.get('room') != null || initialRoom !== '',
  selectedId: null as string | null,
  activeProvider,
  view: initialView as '3d' | 'list',
  showOffline: localStorage.getItem('ua.offline.v2') !== '0',
  tab: 'live' as 'live' | 'info',
  follow: true,
  since: 0,
  mode: 'live' as 'live' | 'demo',
  home: '',
  availableProviders: [] as AgentProvider[],
};

const stage = $('stage');
const panel = $('panel');
const listView = $('list-view');
const emptyEl = $('empty');
const live = $('live');
let scene: OfficeScene;
let announcedStates = new Map<string, AgentState>();
let primed = false;

const providerSessions = (): SessionSummary[] => store.mode === 'demo' ? store.all : store.all.filter((s) => (s.provider ?? 'copilot') === store.activeProvider);
const providerRooms = (): RoomInfo[] => store.mode === 'demo' ? store.rooms : store.rooms.filter((r) => (r.provider ?? 'copilot') === store.activeProvider);
const roomSessions = (id: string): SessionSummary[] => store.activeProvider === 'codex' && id === CODEX_ALL_ROOM ? providerSessions() : providerSessions().filter((s) => s.room === id);
const shown = (list: SessionSummary[]): SessionSummary[] => (store.showOffline ? list : list.filter((s) => s.state !== 'offline'));
/** Agents in the room you are in. */
const visible = (): SessionSummary[] => shown(roomSessions(store.room));
/** Agents in every room (list view). */
const visibleEverywhere = (): SessionSummary[] => shown(providerSessions());
const currentRoom = (): RoomInfo | undefined => providerRooms().find((r) => r.id === store.room);
const selected = (): SessionSummary | undefined => providerSessions().find((s) => s.id === store.selectedId);
const panelPx = (): number => (store.selectedId ? Math.min(440, Math.round(window.innerWidth * 0.46)) : 0);
const roomsPx = (): number => (providerRooms().length > 1 ? $('rooms').offsetWidth + 12 : 0);

function migrateCodexDefaultRoom(): void {
  if (store.activeProvider !== 'codex' || params.has('room') || localStorage.getItem('ua.codex.all-threads-default.v1') === '1') return;
  store.room = CODEX_ALL_ROOM;
  store.roomPinned = true;
  localStorage.setItem('ua.room.codex', CODEX_ALL_ROOM);
  localStorage.setItem('ua.codex.all-threads-default.v1', '1');
}

let providerButtonsSig = '';

function renderProviderSwitch(): void {
  const box = $('provider-switch');
  const choice = box.closest<HTMLElement>('.provider-choice')!;
  const providers = store.mode === 'demo' ? [] : store.availableProviders.filter((key) => Object.prototype.hasOwnProperty.call(PROVIDERS, key));
  const sig = providers.join('|');
  if (sig !== providerButtonsSig) {
    providerButtonsSig = sig;
    box.replaceChildren(...providers.map((key) => {
      const button = h('button', { text: PROVIDERS[key].buttonLabel, attrs: { type: 'button', 'data-provider': key, title: `Show ${PROVIDERS[key].label} sessions` } });
      return button;
    }));
    const options = $('provider-picker-options');
    options.replaceChildren(...providers.map((key) => {
      const button = h('button', { class: 'provider-option', attrs: { type: 'button', 'data-provider': key, title: `Show ${PROVIDERS[key].label} sessions` } },
        h('span', { class: 'provider-option-title', text: PROVIDERS[key].label }),
        h('span', { class: 'provider-option-description', text: PROVIDERS[key].description }),
      );
      return button;
    }));
  }
  box.hidden = providers.length < 2;
  choice.hidden = providers.length < 2;
  for (const button of box.querySelectorAll<HTMLButtonElement>('[data-provider]')) {
    button.setAttribute('aria-pressed', String(button.dataset.provider === store.activeProvider));
  }
  for (const button of $('provider-picker-options').querySelectorAll<HTMLButtonElement>('[data-provider]')) {
    button.setAttribute('aria-pressed', String(button.dataset.provider === store.activeProvider));
  }
}

function providerLabel(provider: ProviderKey = store.activeProvider): string {
  return PROVIDERS[provider].label;
}

function openProviderApp(provider: ProviderKey): void {
  if (store.mode === 'demo' || !store.availableProviders.includes(provider)) return;
  void window.ua.openProviderApp(provider).then((result) => {
    if (!result.ok) toast(`Could not open ${providerLabel(provider)}. Start it from Windows and try again.`, true);
  }).catch(() => toast(`Could not open ${providerLabel(provider)}. Start it from Windows and try again.`, true));
}

function openCopilotLauncher(): void {
  if (store.mode !== 'demo' && store.activeProvider !== 'copilot') {
    toast('Start a Codex Local or Worktree task in the ChatGPT app.');
    return;
  }
  if (!currentRoom()?.canLaunch) {
    toast('Start a task in the ChatGPT app to add it here.');
    return;
  }
  openLauncher();
}

/* ───────────── top bar ───────────── */

function renderTopbar(): void {
  const all = providerSessions();
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
  renderProviderSwitch();
  $('control-option').hidden = store.mode !== 'demo' && store.activeProvider !== 'copilot';
  $('credits').hidden = store.mode !== 'demo' && store.activeProvider !== 'copilot';
  ($('show-offline') as HTMLInputElement).checked = store.showOffline;
  $('overview').hidden = store.view !== '3d';
  const newAgent = $<HTMLButtonElement>('new-agent');
  newAgent.hidden = store.mode !== 'demo' && store.activeProvider !== 'copilot';
  newAgent.disabled = !currentRoom()?.canLaunch;
  newAgent.title = currentRoom()?.canLaunch ? 'Start a new GitHub Copilot agent in this room (N)' : 'Start a task in the ChatGPT app to add it here';
}

/* ───────────── rooms ───────────── */

const roomStats = (id: string): { needs: number; working: number; total: number } => {
  const list = roomSessions(id);
  return {
    needs: list.filter((s) => NEEDS_YOU.includes(s.state)).length,
    working: list.filter((s) => s.state === 'tool' || s.state === 'thinking' || s.state === 'compacting').length,
    total: list.length,
  };
};

let roomsSig = '';

function renderRooms(): void {
  const box = $('rooms');
  const rooms = providerRooms();
  const codexSidebar = store.mode !== 'demo' && store.activeProvider === 'codex';
  const chats = codexSidebar ? shown(providerSessions()).slice().sort((a, b) => b.lastEventAt - a.lastEventAt) : [];
  const multi = rooms.length > 1 || codexSidebar;
  const showChats = codexSidebar && sidebarView === 'chats';
  box.hidden = !multi;
  box.setAttribute('aria-label', showChats ? 'Codex chats' : 'Rooms');
  document.body.classList.toggle('has-rooms', multi);
  if (!multi) return;
  const sig = [sidebarView, store.activeProvider, store.showOffline, store.selectedId ?? '', ...rooms
    .map((r) => {
      const st = roomStats(r.id);
      return `${r.id}:${r.name}:${st.needs}:${st.working}:${r.id === store.room ? 1 : 0}`;
    }), ...chats.map((s) => `${s.id}:${s.title}:${s.room}:${s.state}:${s.lastEventAt}`)].join('|');
  if (sig === roomsSig) return;
  roomsSig = sig;
  const hadFocus = box.contains(document.activeElement);
  const focusedSidebarItem = document.activeElement as HTMLElement;
  const focusedChatId = focusedSidebarItem.dataset.chatId;
  const focusedSidebarView = focusedSidebarItem.dataset.sidebarView;
  const rows = rooms.map((r) => {
    const st = roomStats(r.id);
    const btn = h(
      'button',
      { class: 'room', attrs: { type: 'button', 'data-room': r.id, 'data-kind': r.kind, 'aria-current': String(r.id === store.room), title: r.name } },
      h('span', { class: 'room-ico', attrs: { 'aria-hidden': 'true' } }),
      h('span', { class: 'room-name', text: r.name }),
      st.needs > 0 ? h('span', { class: 'badge needs', text: String(st.needs), attrs: { 'aria-label': `${st.needs} need you` } }) : null,
      st.working > 0 ? h('span', { class: 'badge work', text: String(st.working), attrs: { 'aria-label': `${st.working} working` } }) : null,
    );
    return h('li', {}, btn);
  });
  const roomList = $('room-list');
  const chatList = $('chat-list');
  roomList.hidden = showChats;
  chatList.hidden = !showChats;
  roomList.replaceChildren(...rows);
  const chatRows = chats.map((s) => {
    const dot = h('i', { class: 'dot', attrs: { 'aria-label': stateText(s) } });
    dot.style.background = STATE_COLOR[s.state];
    return h('li', {}, h('button', {
      class: 'chat-entry',
      attrs: { type: 'button', 'data-chat-id': s.id, 'aria-current': String(s.id === store.selectedId), title: s.title, 'aria-label': s.title },
    }, dot,
    h('span', { class: 'chat-copy' }, h('span', { class: 'chat-title', text: s.title }))));
  });
  chatList.replaceChildren(...chatRows);
  $('rooms-heading').textContent = showChats ? 'Chats' : 'Rooms';
  $('rooms-count').textContent = String(showChats ? chats.length : rooms.length);
  const tabs = $('sidebar-tabs');
  tabs.hidden = !codexSidebar;
  for (const button of tabs.querySelectorAll<HTMLButtonElement>('[data-sidebar-view]')) {
    button.setAttribute('aria-pressed', String(button.dataset.sidebarView === sidebarView));
  }
  const cur = (showChats ? chatList : roomList).querySelector<HTMLElement>('[aria-current="true"]');
  cur?.scrollIntoView({ block: 'nearest' });
  if (hadFocus) {
    const focused = focusedSidebarView
      ? [...tabs.querySelectorAll<HTMLElement>('[data-sidebar-view]')].find((item) => item.dataset.sidebarView === focusedSidebarView)
      : focusedChatId && showChats
        ? [...chatList.querySelectorAll<HTMLElement>('[data-chat-id]')].find((item) => item.dataset.chatId === focusedChatId)
        : null;
    (focused ?? cur)?.focus({ preventScroll: true });
  }
}

/** Moves to another room (the agent panel closes unless the selected agent lives there). */
function switchRoom(id: string, keepSelection = false): void {
  if (id === store.room || !providerRooms().some((r) => r.id === id)) return;
  store.room = id;
  store.roomPinned = true;
  localStorage.setItem(`ua.room.${store.activeProvider}`, id);
  if (store.activeProvider === 'copilot') localStorage.setItem('ua.room', id);
  if (!keepSelection) select(null);
  render();
}

function switchProvider(provider: ProviderKey): void {
  if (!store.availableProviders.includes(provider)) return;
  const picker = $('provider-picker') as HTMLDialogElement;
  if (picker.open) picker.close();
  if (provider === store.activeProvider) {
    openProviderApp(provider);
    return;
  }
  if (!store.availableProviders.includes(provider)) return;
  localStorage.setItem(`ua.view.${store.activeProvider}`, store.view);
  store.activeProvider = provider;
  sidebarView = provider === 'codex' && localStorage.getItem('ua.sidebar.codex') === 'rooms' ? 'rooms' : provider === 'codex' ? 'chats' : 'rooms';
  localStorage.setItem('ua.provider', provider);
  store.room = localStorage.getItem(`ua.room.${provider}`) ?? '';
  store.view = (localStorage.getItem(`ua.view.${provider}`) ?? (provider === 'codex' ? 'list' : '3d')) as '3d' | 'list';
  localStorage.setItem('ua.view', store.view);
  migrateCodexDefaultRoom();
  store.roomPinned = store.room !== '';
  store.selectedId = null;
  store.since = 0;
  store.follow = true;
  timelineEls.clear();
  timelineBox = $('timeline') as HTMLOListElement;
  timelineBox.replaceChildren();
  roomsSig = '';
  scene.setSelected(null, panelPx());
  render();
  scene.frameAll(true);
  openProviderApp(provider);
}

function stepRoom(dir: number): void {
  const rooms = providerRooms();
  if (rooms.length < 2) return;
  const i = rooms.findIndex((r) => r.id === store.room);
  switchRoom(rooms[(i + dir + rooms.length) % rooms.length].id);
}

/** Picks the first room to show: the saved/pinned one, else the room where something is going on. */
function pickRoom(): void {
  const rooms = providerRooms();
  if (rooms.some((r) => r.id === store.room)) return;
  const hot = rooms.find((r) => roomStats(r.id).needs > 0) ?? rooms.find((r) => roomStats(r.id).working > 0) ?? rooms.find((r) => roomStats(r.id).total > 0);
  store.room = (hot ?? rooms[0])?.id ?? '';
}

/* ───────────── list view ───────────── */

function renderList(): void {
  if (store.view !== 'list') return;
  const rows = visibleEverywhere();
  const head = h('thead', {}, h('tr', {}, ...['State', 'Agent', 'Model', 'Doing now', 'Context', 'Cost', 'Active'].map((t) => h('th', { text: t, attrs: { scope: 'col' } }))));
  const body = h('tbody');
  const now = Date.now();
  for (const s of rows) {
    const state = h('td', { class: 'c-state' });
    const dot = h('i', { class: 'dot' });
    dot.style.background = STATE_COLOR[s.state];
    state.append(dot, h('span', { text: stateText(s) }));
    const name = h('td', { class: 'c-name' });
    const btn = h('button', { class: 'row-open', text: s.title, attrs: { type: 'button', 'data-id': s.id, title: s.title } });
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
  const isCodex = s.provider === 'codex';
  const openInApp = h('button', { class: 'btn small', text: isCodex ? 'Open in ChatGPT' : 'Open in Copilot', attrs: { type: 'button', title: isCodex ? 'Open this thread in the ChatGPT desktop app' : 'Open this session in the GitHub Copilot app' } });
  openInApp.addEventListener('click', () => {
    const opening = isCodex ? window.ua.openInCodex(s.id) : window.ua.openInCopilot(s.id);
    void opening.then((r) => {
      const appName = isCodex ? 'ChatGPT' : 'GitHub Copilot';
      toast(r.ok ? `Opened this session in ${appName}.` : (r.error ?? `Could not open ${appName}.`), !r.ok);
    }).catch(() => toast(`Could not open ${isCodex ? 'ChatGPT' : 'GitHub Copilot'}.`, true));
  });
  head.replaceChildren(
    h('div', { class: 'ph-row' },
      h('h2', { text: s.title, attrs: { title: s.title } }),
      openInApp,
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
  renderControl();
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
  copy.addEventListener('click', () => void navigator.clipboard?.writeText(s.provider === 'codex' ? s.id.slice('codex:'.length) : s.id));

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
      h('p', { text: s.provider === 'codex' ? 'History is read through the official local Codex App Server. Open this thread in the ChatGPT app to reply, stop the task or handle approval requests.' : 'Sending messages, stopping an agent and answering or approving requests need the bridge extension. Not installed yet — this version only watches.' })),
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
      $('src').textContent = d.source?.startsWith('Codex App Server') ? d.source : d.source ? 'live from events.jsonl' : 'no event log for this session';
    }
  } finally {
    pollBusy = false;
  }
}

/* ───────────── selection & wiring ───────────── */

function select(id: string | null): void {
  if (id === store.selectedId) return;
  const target = id ? providerSessions().find((s) => s.id === id) : undefined;
  if (id && !target) return;
  if (target && target.room !== store.room) switchRoom(target.room);
  store.selectedId = id;
  store.since = 0;
  store.follow = true;
  timelineEls.clear();
  timelineBox = $('timeline') as HTMLOListElement;
  timelineBox.replaceChildren();
  scene.setSelected(id, panelPx());
  renderPanel();
  renderRooms();
  renderList();
  if (id) void pollDetail();
}

function render(): void {
  pickRoom();
  renderTopbar();
  renderRooms();
  const vis = visible();
  scene.setInsets(roomsPx());
  scene.setSessions(vis, store.room, currentRoom()?.name ?? '');
  emptyEl.hidden = vis.length > 0 || store.view !== '3d';
  if (!vis.length) {
    const hidden = roomSessions(store.room).length;
    emptyEl.querySelector('h2')!.textContent = currentRoom() ? `All desks are free in ${currentRoom()!.name}` : `No ${providerLabel()} sessions yet`;
    emptyEl.querySelector('p')!.textContent = hidden
      ? `${hidden} past session${hidden > 1 ? 's are' : ' is'} hidden here. Turn on “Show offline” to seat them.`
      : store.activeProvider === 'codex' ? 'Start a Codex Local or Worktree task in ChatGPT; it will appear here.' : 'No agent has worked in this folder yet. Click a desk to start one.';
  }
  if (store.selectedId && !vis.find((s) => s.id === store.selectedId)) select(null);
  renderPanel();
  renderList();
  renderLauncher();
  stage.hidden = store.view !== '3d';
  listView.hidden = store.view !== 'list';
}

function announce(list: SessionSummary[]): void {
  for (const s of list.filter((item) => store.mode === 'demo' || (item.provider ?? 'copilot') === store.activeProvider)) {
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
  scene = new OfficeScene(stage, { onSelect: select, onEmptyDesk: openCopilotLauncher });
  initControl(selected);
  initLauncher(currentRoom);
  initCredits();
  window.ua.onControl(() => renderLauncher());

  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const open = t.closest<HTMLElement>('.row-open');
    if (open?.dataset.id) select(open.dataset.id);
    const room = t.closest<HTMLElement>('[data-room]');
    if (room?.dataset.room) switchRoom(room.dataset.room);
    const chat = t.closest<HTMLElement>('[data-chat-id]');
    if (chat?.dataset.chatId) select(chat.dataset.chatId);
    const sidebarTab = t.closest<HTMLElement>('[data-sidebar-view]');
    if (sidebarTab && (sidebarTab.dataset.sidebarView === 'chats' || sidebarTab.dataset.sidebarView === 'rooms')) {
      sidebarView = sidebarTab.dataset.sidebarView;
      if (store.activeProvider === 'codex') localStorage.setItem('ua.sidebar.codex', sidebarView);
      roomsSig = '';
      renderRooms();
    }
    const provider = providerFromClickTarget(t);
    if (provider) switchProvider(provider);
    if (t.closest('#panel-close')) select(null);
    const view = t.closest<HTMLElement>('[data-view]');
    if (view) {
      store.view = view.dataset.view as '3d' | 'list';
      localStorage.setItem('ua.view', store.view);
      localStorage.setItem(`ua.view.${store.activeProvider}`, store.view);
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
    if (t.closest('#new-agent')) openCopilotLauncher();
    const winBtn = t.closest<HTMLElement>('[data-win]');
    if (winBtn) window.ua.winAction(winBtn.dataset.win as 'minimize' | 'maximize' | 'close');
  });
  window.ua.onWinState((s) => {
    document.body.classList.toggle('maximized', s.maximized);
    document.body.classList.toggle('fullscreen', s.fullscreen);
    const label = s.maximized ? 'Restore' : 'Maximize';
    $('win-max').setAttribute('aria-label', label);
    $('win-max').title = label;
  });
  for (const grip of document.querySelectorAll<HTMLElement>('.grip')) {
    grip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      grip.setPointerCapture(e.pointerId);
      window.ua.winResize(grip.dataset.edge ?? null);
    });
    for (const end of ['pointerup', 'pointercancel', 'lostpointercapture']) grip.addEventListener(end, () => window.ua.winResize(null));
  }
  window.addEventListener('blur', () => window.ua.winResize(null));
  $('show-offline').addEventListener('change', (e) => {
    store.showOffline = (e.target as HTMLInputElement).checked;
    localStorage.setItem('ua.offline.v2', store.showOffline ? '1' : '0');
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
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || ($('launch') as HTMLDialogElement).open) return;
    if (e.key === 'Escape') select(null);
    else if (e.key === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      openCopilotLauncher();
    } else if (e.key === 'ArrowRight') cycle(1);
    else if (e.key === 'ArrowLeft') cycle(-1);
    else if (e.key === 'PageDown' || (e.altKey && e.key === 'ArrowDown')) {
      e.preventDefault();
      stepRoom(1);
    } else if (e.key === 'PageUp' || (e.altKey && e.key === 'ArrowUp')) {
      e.preventDefault();
      stepRoom(-1);
    }
  });
  window.addEventListener('resize', () => {
    scene.setInsets(roomsPx());
    scene.setSelected(store.selectedId, panelPx());
  });

  window.ua.onSummaries((snap) => {
    store.all = snap.sessions;
    store.rooms = snap.rooms;
    announce(snap.sessions);
    render();
  });
  window.ua.onFocus((id) => {
    const target = store.all.find((s) => s.id === id);
    if (target?.provider && target.provider !== store.activeProvider) switchProvider(target.provider);
    select(id);
  });
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
  store.availableProviders = info.providerKeys ?? [];
  if (!store.availableProviders.includes(store.activeProvider) && store.availableProviders.length) {
    store.activeProvider = store.availableProviders[0];
    store.room = localStorage.getItem(`ua.room.${store.activeProvider}`) ?? '';
  }
  migrateCodexDefaultRoom();
  localStorage.setItem('ua.provider', store.activeProvider);
  localStorage.setItem(`ua.view.${store.activeProvider}`, store.view);
  if (store.activeProvider === 'copilot' && store.room) localStorage.setItem('ua.room.copilot', store.room);
  const snap = await window.ua.list();
  store.all = snap.sessions;
  store.rooms = snap.rooms;
  announce(store.all);
  render();
  if (store.mode !== 'demo') {
    const hasSelectedSession = params.get('select') !== null && params.get('select') !== '';
    if (hasSelectedSession || params.get('launch') === '1' || store.availableProviders.length < 2) openProviderApp(store.activeProvider);
    else ($('provider-picker') as HTMLDialogElement).showModal();
  }
  if (params.get('launch') === '1' && store.activeProvider === 'copilot') setTimeout(openCopilotLauncher, 800);
  const nums = (key: string): [number, number, number] | null => {
    const p = params.get(key)?.split(',').map(Number);
    return p && p.length === 3 && p.every(Number.isFinite) ? (p as [number, number, number]) : null;
  };
  const cam = nums('cam');
  if (cam) scene.setCamera(cam, nums('look') ?? [0, 1.2, 0]);
  const sel = params.get('select');
  if (sel !== null) {
    const vis = visible();
    const pick = vis[Number(sel)] ?? vis[0];
    if (pick) select(pick.id);
  }
}

void start();
