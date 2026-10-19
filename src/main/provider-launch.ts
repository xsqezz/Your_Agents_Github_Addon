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
  try {
    await openExternal(PROVIDERS[provider].appUrl);
  } finally {
    if (window) keepWindowVisibleAfterProviderLaunch(window, schedule);
  }
}
