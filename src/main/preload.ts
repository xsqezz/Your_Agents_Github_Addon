import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('ua', {
  info: () => ipcRenderer.invoke('ua:info'),
  list: () => ipcRenderer.invoke('ua:list'),
  detail: (id: string, since: number) => ipcRenderer.invoke('ua:detail', id, since),
  onSummaries: (cb: (list: unknown) => void) => {
    ipcRenderer.on('ua:summaries', (_e, list) => cb(list));
  },
  onFocus: (cb: (id: string) => void) => {
    ipcRenderer.on('ua:focus', (_e, id) => cb(id));
  },
});
