import type { AgentProvider } from '../core/types.ts';
import { PROVIDERS } from '../core/providers.ts';
import { keepWindowVisibleAfterProviderLaunch, type WindowVisibility } from './provider-window.ts';

type OpenExternal = (url: string) => Promise<void>;

/** Open the selected companion app and recover UR Agents if Windows minimizes it. */
export async function launchProviderApp(
  provider: AgentProvider,
  openExternal: OpenExternal,
  window: WindowVisibility | null,
  schedule?: (callback: () => void, delayMs: number) => unknown,
): Promise<void> {
  // Arm visibility recovery before ShellExecute; URI handlers can hide the caller after
  // openExternal has already returned, so checking only the promise's completion is too early.
  const recover = window ? keepWindowVisibleAfterProviderLaunch(window, schedule) : undefined;
  try {
    await openExternal(PROVIDERS[provider].appUrl);
  } finally {
    recover?.();
  }
}
