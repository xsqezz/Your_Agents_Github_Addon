import { contextBridge, ipcRenderer } from 'electron';
import type { AgentProvider } from '../core/types.ts';

contextBridge.exposeInMainWorld('ua', {
  info: () => ipcRenderer.invoke('ua:info'),
  list: () => ipcRenderer.invoke('ua:list'),
  detail: (id: string, since: number) => ipcRenderer.invoke('ua:detail', id, since),
  controlState: () => ipcRenderer.invoke('ua:control-state'),
  controlSetEnabled: (on: boolean) => ipcRenderer.invoke('ua:control-set-enabled', on),
  controlInstall: () => ipcRenderer.invoke('ua:control-install'),
  controlUninstall: () => ipcRenderer.invoke('ua:control-uninstall'),
  controlSend: (id: string, command: unknown) => ipcRenderer.invoke('ua:control-send', id, command),
  launch: (request: unknown) => ipcRenderer.invoke('ua:launch', request),
  signIn: () => ipcRenderer.invoke('ua:sign-in'),
  workKeyStatus: () => ipcRenderer.invoke('ua:work-key-status'),
  workSetApiKey: (key: string) => ipcRenderer.invoke('ua:work-set-api-key', key),
  workRemoveApiKey: () => ipcRenderer.invoke('ua:work-remove-api-key'),
  workCreateSession: (request: unknown) => ipcRenderer.invoke('ua:work-create-session', request),
  workSend: (id: string, message: string) => ipcRenderer.invoke('ua:work-send', id, message),
  workCancel: (id: string) => ipcRenderer.invoke('ua:work-cancel', id),
  openApiKeys: () => ipcRenderer.invoke('ua:open-api-keys'),
  openInCopilot: (sessionId: string) => ipcRenderer.invoke('ua:open-in-copilot', sessionId),
  openInCodex: (sessionId: string) => ipcRenderer.invoke('ua:open-in-codex', sessionId),
  openProviderApp: (provider: AgentProvider) => ipcRenderer.invoke('ua:open-provider-app', provider),
  winAction: (action: string) => ipcRenderer.send('ua:win', action),
  winResize: (edge: string | null) => ipcRenderer.send('ua:win-resize', edge),
  onWinState: (cb: (state: unknown) => void) => {
    ipcRenderer.on('ua:win-state', (_e, state) => cb(state));
  },
  onControl: (cb: (state: unknown) => void) => {
    ipcRenderer.on('ua:control', (_e, state) => cb(state));
  },
  onSummaries: (cb: (list: unknown) => void) => {
    ipcRenderer.on('ua:summaries', (_e, list) => cb(list));
  },
  onFocus: (cb: (id: string) => void) => {
    ipcRenderer.on('ua:focus', (_e, id) => cb(id));
  },
});
