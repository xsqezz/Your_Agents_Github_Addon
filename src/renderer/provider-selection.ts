import type { AgentProvider } from '../core/types.ts';

/** Resolve the provider identity from the button that was actually clicked. */
export function providerFromClickTarget(target: Element): AgentProvider | null {
  const provider = target.closest<HTMLElement>('[data-provider]')?.dataset.provider;
  return provider === 'copilot' || provider === 'codex' ? provider : null;
}
