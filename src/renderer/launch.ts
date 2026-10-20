import { LAUNCH_EFFORTS, LAUNCH_MODES, MAX_PROMPT, MODEL_SUGGESTIONS, type LaunchAccess, type LaunchEffort, type LaunchMode } from '../core/launch.ts';
import type { RoomInfo } from '../core/types.ts';
import { controlState, requestEnable } from './control.ts';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const MODE_LABEL: Record<LaunchMode, string> = { interactive: 'Normal', plan: 'Plan first', autopilot: 'Autopilot' };
const ACCESS_LABEL: Record<LaunchAccess, string> = {
  tools: 'Approve all tools (folder only)',
  full: 'Full access: any path and any URL',
};

let getRoom: () => RoomInfo | undefined = () => undefined;
let busy = false;
let toastTimer: number | undefined;

export function toast(text: string, error = false): void {
  const el = $('toast');
  el.textContent = text;
  el.dataset.error = error ? '1' : '0';
  el.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), 6000);
}

function fill(select: HTMLSelectElement, options: readonly (readonly [string, string])[]): void {
  select.replaceChildren(...options.map(([value, label]) => Object.assign(document.createElement('option'), { value, textContent: label })));
}

function showError(text: string, needsLogin = false): void {
  $('launch-error').textContent = text;
  $('launch-error-box').hidden = !text;
  $('launch-signin').hidden = !needsLogin;
}

function refresh(): void {
  const room = getRoom();
  const state = controlState();
  const codexApi = room?.id === 'codex:api';
  const dlg = $<HTMLDialogElement>('launch');
  $('launch-room').textContent = room?.name ?? '';
  $('launch-title').textContent = codexApi ? 'New Codex API task' : 'New agent';
  $('launch-hint').textContent = codexApi
    ? 'Runs in an OpenAI-hosted Codex workspace, separate from local Codex chats. API and sandbox usage are billed to your Platform project. Only public GitHub repositories can be cloned here; network access is disabled unless you enable it below.'
    : 'It runs on its own until the task is done. Open it in the GitHub Copilot app to continue the conversation.';
  $('launch-model').setAttribute('placeholder', codexApi ? 'gpt-6-astra' : 'Default');
  $('launch-name').setAttribute('placeholder', codexApi ? 'Shown in ur-agents' : 'Shown in the Copilot app');
  for (const el of dlg.querySelectorAll<HTMLElement>('.copilot-only')) el.hidden = codexApi;
  for (const el of dlg.querySelectorAll<HTMLElement>('.codex-api-only')) el.hidden = !codexApi;
  const notice = $('launch-notice');
  let text = '';
  let action = false;
  if (!room?.canLaunch) text = 'This room has no folder of its own, so an agent cannot start here. Pick a project room.';
  else if (!codexApi && !state) text = 'Connecting to the control service…';
  else if (!codexApi && state && !state.enabled) {
    text = 'Starting agents needs Control. Turn it on to continue.';
    action = true;
  }
  notice.hidden = !text;
  notice.firstElementChild!.textContent = text;
  $('launch-enable').hidden = !action;
  $<HTMLButtonElement>('launch-go').disabled = !!text || busy;
  $<HTMLButtonElement>('launch-go').firstChild!.textContent = busy ? 'Starting… ' : 'Start agent ';
  for (const el of dlg.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea')) el.disabled = !room?.canLaunch || busy;
}

export function openLauncher(): void {
  const dlg = $<HTMLDialogElement>('launch');
  if (dlg.open) return;
  showError('');
  refresh();
  $('scrim').hidden = false;
  // Not showModal(): a modal dialog would paint its backdrop outside the rounded window.
  dlg.show();
  $<HTMLTextAreaElement>('launch-prompt').focus();
}

/** Keeps the dialog in step with Control being switched on or the room changing under it. */
export function renderLauncher(): void {
  if ($<HTMLDialogElement>('launch').open) refresh();
}

export function initLauncher(roomOf: () => RoomInfo | undefined): void {
  getRoom = roomOf;
  const dlg = $<HTMLDialogElement>('launch');
  fill($('launch-mode') as HTMLSelectElement, LAUNCH_MODES.map((m) => [m, MODE_LABEL[m]] as const));
  fill($('launch-effort') as HTMLSelectElement, [['', 'Model default'], ...LAUNCH_EFFORTS.map((e) => [e, e] as const)]);
  fill($('launch-access') as HTMLSelectElement, (Object.keys(ACCESS_LABEL) as LaunchAccess[]).map((a) => [a, ACCESS_LABEL[a]] as const));
  $('launch-models').replaceChildren(...MODEL_SUGGESTIONS.map((m) => Object.assign(document.createElement('option'), { value: m })));
  $<HTMLTextAreaElement>('launch-prompt').maxLength = MAX_PROMPT;

  $('launch-cancel').addEventListener('click', () => dlg.close());
  $('launch-enable').addEventListener('click', () => requestEnable());
  $('launch-signin').addEventListener('click', () => {
    void window.ua.signIn().then((r) => {
      if (!r.ok) showError(r.error ?? 'Could not open the sign-in.');
      else toast('Finish the sign-in in the window that opened, then press Start agent again.');
    });
  });
  $('scrim').addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => ($('scrim').hidden = true));
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      dlg.close();
    }
  });

  $<HTMLFormElement>('launch-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const room = getRoom();
    if (!room || busy) return;
    const codexApi = room.id === 'codex:api';
    if (!codexApi && $<HTMLSelectElement>('launch-access').value === 'full' && !confirm('Full access lets this agent read and write anywhere on your computer and open any URL, with no prompts.\n\nStart it anyway?')) return;
    busy = true;
    refresh();
    showError('');
    try {
      const r = codexApi
        ? await window.ua.codexApiCreateSession({
          title: $<HTMLInputElement>('launch-name').value,
          prompt: $<HTMLTextAreaElement>('launch-prompt').value,
          model: $<HTMLInputElement>('launch-model').value,
          effort: $<HTMLSelectElement>('launch-effort').value as LaunchEffort | '',
          maxSpendUsd: Number($<HTMLInputElement>('launch-spend').value),
          repositoryUrl: $<HTMLInputElement>('launch-repository').value,
          allowNetwork: $<HTMLInputElement>('launch-network').checked,
        })
        : await window.ua.launch({
          room: room.id,
          prompt: $<HTMLTextAreaElement>('launch-prompt').value,
          model: $<HTMLInputElement>('launch-model').value,
          mode: $<HTMLSelectElement>('launch-mode').value,
          effort: $<HTMLSelectElement>('launch-effort').value as LaunchEffort | '',
          access: $<HTMLSelectElement>('launch-access').value,
          name: $<HTMLInputElement>('launch-name').value,
        });
      if (r.ok) {
        $<HTMLTextAreaElement>('launch-prompt').value = '';
        $<HTMLInputElement>('launch-name').value = '';
        dlg.close();
        toast(('id' in r && r.id) ? 'Codex API task started in the hosted workspace.' : ('note' in r ? r.note : undefined) ?? `Agent started in ${room.name}. It takes a desk in a moment.`);
      } else {
        showError(r.error ?? 'Could not start the agent.', 'needsLogin' in r && r.needsLogin === true);
      }
    } catch {
      showError('Could not reach the app backend.');
    } finally {
      busy = false;
      refresh();
    }
  });
  $<HTMLTextAreaElement>('launch-prompt').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) {
      e.preventDefault();
      $<HTMLFormElement>('launch-form').requestSubmit();
    }
  });
}
