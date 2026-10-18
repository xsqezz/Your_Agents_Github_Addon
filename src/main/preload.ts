import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('ua', {
  info: () => ipcRenderer.invoke('ua:info'),
  list: () => ipcRenderer.invoke('ua:list'),
  detail: (id: string, since: number) => ipcRenderer.invoke('ua:detail', id, since),
  controlState: () => ipcRenderer.invoke('ua:control-state'),
  controlSetEnabled: (on: boolean) => ipcRenderer.invoke('ua:control-set-enabled', on),
  controlInstall: () => ipcRenderer.invoke('ua:control-install'),
  controlUninstall: () => ipcRenderer.invoke('ua:control-uninstall'),
  controlSend: (id: string, command: unknown) => ipcRenderer.invoke('ua:control-send', id, command),
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
