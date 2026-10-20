export interface WindowVisibility {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  isVisible(): boolean;
  restore(): void;
  showInactive(): void;
  focus?(): void;
  on?(event: 'hide' | 'minimize', listener: () => void): unknown;
  removeListener?(event: 'hide' | 'minimize', listener: () => void): unknown;
}

type Schedule = (callback: () => void, delayMs: number) => unknown;

/** Keep the dashboard visible in front while Windows opens a provider app. */
export function keepWindowVisibleAfterProviderLaunch(window: WindowVisibility, schedule: Schedule = setTimeout): () => void {
  const recover = (): void => {
    if (window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    else if (!window.isVisible()) window.showInactive();
    window.focus?.();
  };

  window.on?.('hide', recover);
  window.on?.('minimize', recover);
  recover();
  for (const delay of [250, 1000, 2500, 5000, 8000]) schedule(recover, delay);
  schedule(() => {
    window.removeListener?.('hide', recover);
    window.removeListener?.('minimize', recover);
  }, 10_000);
  return recover;
}
