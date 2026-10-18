import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { app, BrowserWindow, ipcMain, Notification } from 'electron';
import type { AgentState, SessionSummary, Snapshot } from '../core/types.ts';
import type { Controller } from '../core/control.ts';
import { ControlServer } from './control.ts';
import { DemoSource } from './demo.ts';
import { DemoControl } from './democontrol.ts';
import { LiveSource, resolveHome } from './live.ts';
import { CliLauncher, DemoLauncher, type Launcher } from './launcher.ts';
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

/** Squirrel runs the app with --squirrel-* while installing, updating and uninstalling. Shortcuts are the app's job; then it exits at once. */
function handleSquirrel(): boolean {
  const cmd = process.argv[1];
  if (process.platform !== 'win32' || !cmd?.startsWith('--squirrel-')) return false;
  const exe = path.basename(process.execPath);
  const updater = path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
  const run = (args: string[]): void => {
    try {
      spawn(updater, args, { detached: true, stdio: 'ignore' }).unref();
    } catch {
      /* shortcuts are a convenience */
    }
  };
  if (cmd === '--squirrel-install' || cmd === '--squirrel-updated') run([`--createShortcut=${exe}`]);
  else if (cmd === '--squirrel-uninstall') {
    run([`--removeShortcut=${exe}`]);
    // The bridge is useless without the app, so it goes too. Settings and the audit log stay.
    fs.rmSync(path.join(resolveHome(), 'extensions', 'ur-agents-bridge'), { recursive: true, force: true });
    // Squirrel leaves its (then empty) Start Menu folder behind.
    const folder = path.join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'ur-agents');
    setTimeout(() => {
      try {
        fs.rmdirSync(folder);
      } catch {
        /* not empty or already gone */
      }
      app.quit();
    }, 2500);
    return true;
  }
  setTimeout(() => app.quit(), 1000);
  return true;
}

const squirrel = handleSquirrel();
const solo = !squirrel && !demo && !shotFile && !dumpFile;
const gotLock = !solo || app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else if (solo) {
  app.on('second-instance', () => {
    if (win?.isMinimized()) win.restore();
    win?.show();
    win?.focus();
  });
}

let win: BrowserWindow | null = null;
let source: Source;
let control: Controller;
let launcher: Launcher;
let latest: Snapshot = { rooms: [], sessions: [] };
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
  const room = arg('room');
  if (room) query.room = room;
  for (const k of ['cam', 'look']) {
    const v = arg(k);
    if (v) query[k] = v;
  }
  if (has('launch')) query.launch = '1';
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
  if (!gotLock || squirrel) return;
  const home = resolveHome(arg('copilot-home'));
  const pushControl = (): void => {
    win?.webContents.send('ua:control', control?.state());
  };
  if (demo) {
    const ds = new DemoSource(arg('agents')?.split(',').map((m) => m.trim()).filter(Boolean));
    source = ds;
    control = new DemoControl(ds, pushControl);
    launcher = new DemoLauncher(() => control.state().enabled);
  } else {
    const live = new LiveSource(home);
    source = live;
    control = new ControlServer({ copilotHome: home, bridgeSource: path.join(__dirname, 'bridge'), onChange: pushControl });
    launcher = new CliLauncher(live, () => control.state().enabled);
  }

  ipcMain.handle('ua:info', () => source.info());
  ipcMain.handle('ua:list', () => latest);
  ipcMain.handle('ua:detail', (_e, id: string, since: number) => source.detail(String(id), Number(since) || 0));
  ipcMain.handle('ua:control-state', () => control.state());
  ipcMain.handle('ua:control-set-enabled', (_e, on: boolean) => control.setEnabled(on === true));
  ipcMain.handle('ua:control-install', () => control.install());
  ipcMain.handle('ua:control-uninstall', () => control.uninstall());
  ipcMain.handle('ua:control-send', (_e, id: string, command: unknown) => control.send(String(id), command));
  ipcMain.handle('ua:launch', (_e, request: unknown) => launcher.launch(request));

  createWindow();
  await control.start();
  if (demo && has('control')) control.setEnabled(true);
  await source.start((snapshot) => {
    latest = snapshot;
    notifyAttention(snapshot.sessions);
    win?.webContents.send('ua:summaries', snapshot);
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
