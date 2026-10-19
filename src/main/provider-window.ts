export interface WindowVisibility {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  isVisible(): boolean;
  restore(): void;
  showInactive(): void;
}

type Schedule = (callback: () => void, delayMs: number) => unknown;

/** Recover the dashboard if Windows hides it while a provider's URI handler opens. */
export function keepWindowVisibleAfterProviderLaunch(window: WindowVisibility, schedule: Schedule = setTimeout): void {
  const recover = (): void => {
    if (window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    else if (!window.isVisible()) window.showInactive();
  };

  recover();
  schedule(recover, 250);
  schedule(recover, 1000);
}
