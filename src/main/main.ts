import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { app, BrowserWindow, ipcMain, nativeImage, Notification, screen, shell } from 'electron';
import type { AgentProvider, AgentState, SessionSummary, Snapshot } from '../core/types.ts';
import { PROVIDERS } from '../core/providers.ts';
import type { Controller } from '../core/control.ts';
import { ControlServer } from './control.ts';
import { DemoSource } from './demo.ts';
import { DemoControl } from './democontrol.ts';
import { LiveSource, resolveHome } from './live.ts';
import { CodexSource, CombinedSource } from './codex.ts';
import { AgentsApiKeyStore } from './agents-api-key.ts';
import { OpenAIAgentsSource, type CreateWorkSessionRequest } from './agents-api.ts';
import { CliLauncher, DemoLauncher, type Launcher } from './launcher.ts';
import { launchProviderApp } from './provider-launch.ts';
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

if (process.platform === 'win32') app.setAppUserModelId('com.squirrel.ur_agents.ur-agents');

/** Squirrel downloads Electron's default app.ico unless we replace it with our packaged icon. */
function copySquirrelPackageIcon(iconPath: string): void {
  const installRoot = path.resolve(path.dirname(process.execPath), '..');
  try {
    fs.copyFileSync(iconPath, path.join(installRoot, 'app.ico'));
  } catch {
    /* Squirrel may already have installed this release's icon. */
  }
}

/** Create Squirrel-compatible shortcuts with an icon in the public Start Menu directory. */
function createSquirrelShortcuts(): boolean {
  const quote = (value: string): string => `'${value.replace(/'/g, "''")}'`;
  const installRoot = path.resolve(path.dirname(process.execPath), '..');
  const appDirectory = path.dirname(process.execPath);
  const packageIcon = path.join(process.resourcesPath, 'ur-agents.ico');
  const script = `
$ErrorActionPreference = 'Stop'
$target = ${quote(path.join(installRoot, 'ur-agents.exe'))}
$workingDirectory = ${quote(appDirectory)}
$appId = 'com.squirrel.ur_agents.ur-agents'
$desktop = [Environment]::GetFolderPath('DesktopDirectory')
$startMenu = [IO.Path]::Combine($env:APPDATA, 'Microsoft\\Windows\\Start Menu\\Programs\\ur-agents')
New-Item -ItemType Directory -Path $startMenu -Force | Out-Null
$icon = [IO.Path]::Combine($startMenu, 'ur-agents.ico')
Copy-Item -LiteralPath ${quote(packageIcon)} -Destination $icon -Force
$links = @(
  [IO.Path]::Combine($desktop, 'ur-agents.lnk'),
  [IO.Path]::Combine($startMenu, 'ur-agents.lnk')
)
$propertyStoreSource = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential)] public struct UraPropertyKey { public Guid fmtid; public uint pid; }
[StructLayout(LayoutKind.Explicit, Size=16)] public struct UraPropVariant { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr pwszVal; }
[ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] public interface UraPropertyStore { [PreserveSig] int GetCount(out uint count); [PreserveSig] int GetAt(uint index, out UraPropertyKey key); [PreserveSig] int GetValue(ref UraPropertyKey key, out UraPropVariant value); [PreserveSig] int SetValue(ref UraPropertyKey key, ref UraPropVariant value); [PreserveSig] int Commit(); }
public static class UraShortcutIdentity { [DllImport("shell32.dll", CharSet=CharSet.Unicode, PreserveSig=false)] static extern void SHGetPropertyStoreFromParsingName(string path, IntPtr bindCtx, uint flags, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out UraPropertyStore store); [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateFile(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template); [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern uint GetFinalPathNameByHandle(IntPtr handle, StringBuilder path, uint length, uint flags); [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle); public static string ResolveFinalPath(string path) { IntPtr handle = CreateFile(path, 0x80000000, 7, IntPtr.Zero, 3, 0x02000080, IntPtr.Zero); if (handle == new IntPtr(-1)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()); try { StringBuilder result = new StringBuilder(4096); uint length = GetFinalPathNameByHandle(handle, result, (uint)result.Capacity, 0); if (length == 0 || length >= result.Capacity) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()); string finalPath = result.ToString(); if (finalPath.Length >= 4 && finalPath[0] == (char)92 && finalPath[1] == (char)92 && finalPath[2] == '?' && finalPath[3] == (char)92) return finalPath.Substring(4); return finalPath; } finally { CloseHandle(handle); } } static void SetString(string path, uint propertyId, string text) { Guid iid = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"); UraPropertyStore store; SHGetPropertyStoreFromParsingName(path, IntPtr.Zero, 2, ref iid, out store); UraPropertyKey key = new UraPropertyKey { fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = propertyId }; UraPropVariant value = new UraPropVariant { vt = 31, pwszVal = Marshal.StringToCoTaskMemUni(text) }; try { Marshal.ThrowExceptionForHR(store.SetValue(ref key, ref value)); Marshal.ThrowExceptionForHR(store.Commit()); } finally { Marshal.FreeCoTaskMem(value.pwszVal); Marshal.ReleaseComObject(store); } } public static void SetRelaunchIcon(string path, string icon) { SetString(path, 3, icon); } public static void SetAppId(string path, string appId) { SetString(path, 5, appId); } }
public static class UraShellRefresh { [DllImport("shell32.dll", CharSet=CharSet.Unicode)] public static extern void SHChangeNotify(uint eventId, uint flags, string path, IntPtr item); }
'@
Add-Type -TypeDefinition $propertyStoreSource
$target = [UraShortcutIdentity]::ResolveFinalPath($target)
$workingDirectory = [UraShortcutIdentity]::ResolveFinalPath($workingDirectory)
$shell = New-Object -ComObject WScript.Shell
foreach ($linkPath in $links) {
  $link = $shell.CreateShortcut($linkPath)
  $link.TargetPath = $target
  $link.WorkingDirectory = $workingDirectory
  $link.WindowStyle = 1
  $link.IconLocation = \"$icon,0\"
  $link.Description = 'Monitor GitHub Copilot and ChatGPT Codex agents'
  $link.Save()
  [UraShortcutIdentity]::SetRelaunchIcon($linkPath, \"$icon,0\")
  [UraShortcutIdentity]::SetAppId($linkPath, $appId)
  [UraShellRefresh]::SHChangeNotify(0x00002000, 0x0005, $linkPath, [IntPtr]::Zero)
}
$icon = \"$icon,0\"
[UraShellRefresh]::SHChangeNotify(0x00002000, 0x0005, $target, [IntPtr]::Zero)
[UraShellRefresh]::SHChangeNotify(0x08000000, 0, $null, [IntPtr]::Zero)
$uninstallRoot = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
Get-ChildItem $uninstallRoot -ErrorAction SilentlyContinue | ForEach-Object {
  $entry = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
  if ($entry.DisplayName -eq 'ur-agents') {
    Set-ItemProperty $_.PSPath -Name DisplayIcon -Value $icon -ErrorAction SilentlyContinue
  }
}
`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 12_000,
  });
  if (result.status !== 0) {
    const diagnostic = [`status=${result.status}`, result.error?.message, result.stderr, result.stdout].filter(Boolean).join('\n');
    try { fs.writeFileSync(path.join(installRoot, 'shortcut-setup-error.log'), diagnostic); } catch { /* best-effort diagnostic */ }
  }
  return result.status === 0;
}

/** Squirrel runs the app with --squirrel-* while installing, updating and uninstalling. It updates shortcuts, then exits. */
function handleSquirrel(): boolean {
  const cmd = process.argv[1];
  if (process.platform !== 'win32' || !cmd?.startsWith('--squirrel-')) return false;
  const exe = path.basename(process.execPath);
  const updater = path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
  const run = (args: string[]): number | undefined => {
    try {
      const child = spawn(updater, args, { detached: true, stdio: 'ignore' });
      child.unref();
      return child.pid;
    } catch {
      /* shortcuts are a convenience */
      return undefined;
    }
  };
  if (cmd === '--squirrel-install' || cmd === '--squirrel-updated') {
    copySquirrelPackageIcon(path.join(process.resourcesPath, 'ur-agents.ico'));
    if (!createSquirrelShortcuts()) run([`--createShortcut=${exe}`]);
  }
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
let workSource: OpenAIAgentsSource | null = null;
let agentsApiKeys: AgentsApiKeyStore | null = null;
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
    const source = s.provider === 'codex' ? 'Codex' : s.provider === 'work' ? 'ChatGPT Work' : s.provider === 'copilot' ? 'Copilot' : 'Agent';
    const n = new Notification({ title: `${source} · ${s.title}`, body: body.slice(0, 200) });
    n.on('click', () => {
      win?.show();
      win?.focus();
      win?.webContents.send('ua:focus', s.id);
    });
    n.show();
  }
  primed = true;
}

/** The window has no native frame, so edge resizing is done here: follow the cursor while a grip is held. */
let resizeTimer: NodeJS.Timeout | null = null;
function stopResize(): void {
  if (resizeTimer) clearInterval(resizeTimer);
  resizeTimer = null;
}
function startResize(edge: string): void {
  stopResize();
  if (!win || win.isMaximized() || win.isFullScreen() || !/^(n|s|e|w|ne|nw|se|sw)$/.test(edge)) return;
  const target = win;
  const start = target.getBounds();
  const from = screen.getCursorScreenPoint();
  const [minW, minH] = target.getMinimumSize();
  const fuse = Date.now() + 30_000;
  resizeTimer = setInterval(() => {
    if (target.isDestroyed() || Date.now() > fuse) return stopResize();
    const p = screen.getCursorScreenPoint();
    const dx = p.x - from.x;
    const dy = p.y - from.y;
    let { x, y, width, height } = start;
    if (edge.includes('e')) width = Math.max(minW, start.width + dx);
    if (edge.includes('s')) height = Math.max(minH, start.height + dy);
    if (edge.includes('w')) {
      width = Math.max(minW, start.width - dx);
      x = start.x + start.width - width;
    }
    if (edge.includes('n')) {
      height = Math.max(minH, start.height - dy);
      y = start.y + start.height - height;
    }
    target.setBounds({ x, y, width, height });
  }, 8);
}

function createWindow(): void {
  const packagedIcon = path.join(process.resourcesPath, 'ur-agents.ico');
  const iconPath = fs.existsSync(packagedIcon) ? packagedIcon : path.join(__dirname, 'icon.ico');
  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty() && iconPath !== path.join(__dirname, 'icon.ico')) icon = nativeImage.createFromPath(path.join(__dirname, 'icon.ico'));
  win = new BrowserWindow({
    width: 1560,
    height: 960,
    minWidth: 960,
    minHeight: 620,
    icon,
    show: false,
    // The page draws its own rounded window, so the real one is frameless and transparent.
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
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
  const pushState = (): void => {
    win?.webContents.send('ua:win-state', { maximized: win.isMaximized(), fullscreen: win.isFullScreen() });
  };
  win.on('maximize', pushState);
  win.on('unmaximize', pushState);
  win.on('enter-full-screen', pushState);
  win.on('leave-full-screen', pushState);
  win.on('closed', stopResize);
  win.webContents.on('did-finish-load', pushState);

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
    agentsApiKeys = new AgentsApiKeyStore(app.getPath('userData'));
    workSource = new OpenAIAgentsSource(agentsApiKeys);
    source = new CombinedSource(live, new CodexSource(), workSource);
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
  ipcMain.handle('ua:sign-in', () => launcher.signIn());
  ipcMain.handle('ua:work-key-status', () => !!agentsApiKeys?.read());
  ipcMain.handle('ua:work-set-api-key', (_e, key: unknown) => {
    if (!workSource || typeof key !== 'string') return { ok: false, error: 'ChatGPT Work API is unavailable.' };
    return workSource.validateKey(key);
  });
  ipcMain.handle('ua:work-remove-api-key', () => {
    if (!agentsApiKeys) return { ok: false, error: 'ChatGPT Work API is unavailable.' };
    try { workSource?.removeKey(); return { ok: true }; }
    catch (e) { return { ok: false, error: (e as Error).message }; }
  });
  ipcMain.handle('ua:work-create-session', (_e, request: unknown) => {
    if (!workSource || !request || typeof request !== 'object') return { ok: false, error: 'ChatGPT Work API is unavailable.' };
    return workSource.createSession(request as CreateWorkSessionRequest);
  });
  ipcMain.handle('ua:work-send', (_e, id: unknown, message: unknown) => workSource?.send(String(id), String(message)) ?? { ok: false, error: 'ChatGPT Work API is unavailable.' });
  ipcMain.handle('ua:work-cancel', (_e, id: unknown) => workSource?.cancel(String(id)) ?? { ok: false, error: 'ChatGPT Work API is unavailable.' });
  ipcMain.handle('ua:open-api-keys', async () => {
    try { await shell.openExternal('https://platform.openai.com/api-keys'); return { ok: true }; }
    catch (e) { return { ok: false, error: `Could not open OpenAI Platform: ${(e as Error).message}` }; }
  });
  ipcMain.handle('ua:open-in-copilot', async (_e, sessionId: unknown) => {
    if (typeof sessionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(sessionId)) return { ok: false, error: 'Invalid session ID.' };
    try {
      await shell.openExternal(`ghapp://sessions/${sessionId}`);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: `Could not open GitHub Copilot: ${(e as Error).message}` };
    }
  });
  ipcMain.handle('ua:open-provider-app', async (_e, provider: unknown) => {
    if (provider !== 'copilot' && provider !== 'codex' && provider !== 'work') return { ok: false, error: 'Unsupported provider.' };
    try {
      await launchProviderApp(provider, (url) => shell.openExternal(url), win);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: `Could not open ${PROVIDERS[provider].label}: ${(e as Error).message}` };
    }
  });
  ipcMain.handle('ua:open-in-codex', async (_e, sessionId: unknown) => {
    if (typeof sessionId !== 'string' || !sessionId.startsWith('codex:')) return { ok: false, error: 'Invalid Codex thread ID.' };
    const id = sessionId.slice('codex:'.length);
    if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: 'Invalid Codex thread ID.' };
    try {
      await shell.openExternal(`codex://threads/${id}`);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: `Could not open ChatGPT: ${(e as Error).message}` };
    }
  });
  ipcMain.on('ua:win', (e, action: unknown) => {
    if (!win || e.sender !== win.webContents) return;
    if (action === 'minimize') win.minimize();
    else if (action === 'maximize') (win.isMaximized() ? win.unmaximize() : win.maximize());
    else if (action === 'close') win.close();
  });
  ipcMain.on('ua:win-resize', (e, edge: unknown) => {
    if (!win || e.sender !== win.webContents) return;
    if (typeof edge === 'string') startResize(edge);
    else stopResize();
  });

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
