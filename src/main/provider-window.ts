export interface WindowVisibility {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  isVisible(): boolean;
  restore(): void;
  showInactive(): void;
  on?(event: 'hide' | 'minimize', listener: () => void): unknown;
  removeListener?(event: 'hide' | 'minimize', listener: () => void): unknown;
}

type Schedule = (callback: () => void, delayMs: number) => unknown;

/** Recover the dashboard if Windows hides or minimizes it while a provider app is opening. */
export function keepWindowVisibleAfterProviderLaunch(window: WindowVisibility, schedule: Schedule = setTimeout): () => void {
  const recover = (): void => {
    if (window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    else if (!window.isVisible()) window.showInactive();
  };

  window.on?.('hide', recover);
  window.on?.('minimize', recover);
  recover();
  for (const delay of [250, 1000, 2500, 5000]) schedule(recover, delay);
  schedule(() => {
    window.removeListener?.('hide', recover);
    window.removeListener?.('minimize', recover);
  }, 8000);
  return recover;
}
