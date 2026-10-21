import { spawnSync } from 'node:child_process';
import { PROVIDERS } from '../core/providers.ts';
import { keepWindowVisibleAfterProviderLaunch, type WindowVisibility } from './provider-window.ts';

type OpenExternal = (url: string) => Promise<void>;
type IsProviderRunning = () => boolean;

/** Check the exact desktop app process without activating it or changing its window. */
export function isProviderAppRunning(): boolean {
  if (process.platform !== 'win32') return false;
  try {
    const result = spawnSync('tasklist.exe', [
      '/FI', `IMAGENAME eq ${PROVIDERS.copilot.processName}`,
      '/FO', 'CSV', '/NH',
    ], { encoding: 'utf8', windowsHide: true, timeout: 3000 });
    if (result.status !== 0 || result.error) return false;
    return result.stdout.split(/\r?\n/).some((line) => {
      const imageName = /^\s*"([^"]+)"/.exec(line)?.[1];
      return imageName?.toLowerCase() === PROVIDERS.copilot.processName.toLowerCase();
    });
  } catch {
    // If process enumeration is unavailable, preserve the launch behavior.
    return false;
  }
}

/** Open a closed companion app in the background, or leave a running one untouched. */
export async function launchProviderApp(
  openExternal: OpenExternal,
  window: WindowVisibility | null,
  schedule?: (callback: () => void, delayMs: number) => unknown,
  providerIsRunning: IsProviderRunning = isProviderAppRunning,
): Promise<void> {
  if (providerIsRunning()) {
    if (window && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore();
      else if (!window.isVisible()) window.showInactive();
      window.focus?.();
    }
    return;
  }
  // Arm visibility recovery before ShellExecute; URI handlers can hide the caller after
  // openExternal has already returned, so checking only the promise's completion is too early.
  // Re-focus UR Agents after launch so the companion app opens behind the dashboard.
  const recover = window ? keepWindowVisibleAfterProviderLaunch(window, schedule) : undefined;
  try {
    await openExternal(PROVIDERS.copilot.appUrl);
  } finally {
    recover?.();
  }
}
