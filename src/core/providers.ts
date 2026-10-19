import type { AgentProvider } from './types.ts';

/** Add a provider here when its source and official desktop-app launcher are implemented. */
export const PROVIDERS: Record<AgentProvider, { label: string; buttonLabel: string; appUrl: string }> = {
  copilot: {
    label: 'GitHub Copilot',
    buttonLabel: 'Copilot',
    appUrl: 'ghapp://sessions',
  },
  codex: {
    label: 'ChatGPT Codex',
    buttonLabel: 'ChatGPT Codex',
    appUrl: 'codex://threads',
  },
};
