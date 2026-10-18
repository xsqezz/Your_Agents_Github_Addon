import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, ipcMain, Notification } from 'electron';
import type { AgentState, SessionSummary } from '../core/types.ts';
import type { Controller } from '../core/control.ts';
import { ControlServer } from './control.ts';
import { DemoSource } from './demo.ts';
import { DemoControl } from './democontrol.ts';
import { LiveSource, resolveHome } from './live.ts';
import type { Source } from './source.ts';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? '') : undefined;
}
const has = (name: string): boolean => process.argv.includes(`--${name}`);

const demo = has('demo');
const shotFile = arg('screenshot');
const shotDelay = Number(arg('delay')) || 4500;
const dumpFile = arg('dump');

const ATTENTION: AgentState[] = ['awaiting-input', 'awaiting-permission', 'error'];

let win: BrowserWindow | null = null;
let source: Source;
let control: Controller;
let latest: SessionSummary[] = [];
let primed = false;
const lastStates = new Map<string, AgentState>();

function notifyAttention(list: SessionSummary[]): void {
  for (const s of list) {
    const prev = lastStates.get(s.id);
    lastStates.set(s.id, s.state);
    if (!primed || prev === s.state || !ATTENTION.includes(s.state) || !s.live) continue;
    if (win?.isFocused() || !Notification.isSupported()) continue;
    const body = s.state === 'awaiting-permission' ? `Needs permission — ${s.activity}` : s.state === 'awaiting-input' ? `Asks: ${s.activity}` : `Error: ${s.activity}`;
    const n = new Notification({ title: s.title, body: body.slice(0, 200) });
    n.on('click', () => {
      win?.show();
      win?.focus();
      win?.webContents.send('ua:focus', s.id);
    });
    n.show();
  }
  primed = true;
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1560,
    height: 960,
    minWidth: 960,
    minHeight: 620,
    show: false,
    backgroundColor: '#090d12',
    title: 'ur-agents',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.once('ready-to-show', () => win?.show());

  const query: Record<string, string> = {};
  const sel = arg('select');
  if (sel !== undefined) query.select = sel;
  const view = arg('view');
  if (view) query.view = view;
  void win.loadFile(path.join(__dirname, 'index.html'), { query });

  if (shotFile) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const image = await win!.webContents.capturePage();
        fs.mkdirSync(path.dirname(path.resolve(shotFile)), { recursive: true });
        fs.writeFileSync(shotFile, image.toPNG());
        if (dumpFile) fs.writeFileSync(dumpFile, JSON.stringify(latest, null, 2));
        app.quit();
      }, shotDelay);
    });
  }
}

app.whenReady().then(async () => {
  const home = resolveHome(arg('copilot-home'));
  const pushControl = (): void => {
    win?.webContents.send('ua:control', control?.state());
  };
  if (demo) {
    const ds = new DemoSource(arg('agents')?.split(',').map((m) => m.trim()).filter(Boolean));
    source = ds;
    control = new DemoControl(ds, pushControl);
  } else {
    source = new LiveSource(home);
    control = new ControlServer({ copilotHome: home, bridgeSource: path.join(__dirname, 'bridge'), onChange: pushControl });
  }

  ipcMain.handle('ua:info', () => source.info());
  ipcMain.handle('ua:list', () => latest);
  ipcMain.handle('ua:detail', (_e, id: string, since: number) => source.detail(String(id), Number(since) || 0));
  ipcMain.handle('ua:control-state', () => control.state());
  ipcMain.handle('ua:control-set-enabled', (_e, on: boolean) => control.setEnabled(on === true));
  ipcMain.handle('ua:control-install', () => control.install());
  ipcMain.handle('ua:control-uninstall', () => control.uninstall());
  ipcMain.handle('ua:control-send', (_e, id: string, command: unknown) => control.send(String(id), command));

  createWindow();
  await control.start();
  if (demo && has('control')) control.setEnabled(true);
  await source.start((list) => {
    latest = list;
    notifyAttention(list);
    win?.webContents.send('ua:summaries', list);
  });
  if (dumpFile && !shotFile) {
    setTimeout(() => {
      fs.writeFileSync(dumpFile, JSON.stringify(latest, null, 2));
      app.quit();
    }, 1500);
  }
});

app.on('window-all-closed', () => {
  source?.stop();
  control?.stop();
  app.quit();
});
