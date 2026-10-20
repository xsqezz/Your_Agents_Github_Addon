import type { AgentProvider } from './types.ts';

/** Add a provider here when its session source and desktop-app launcher are implemented. */
export const PROVIDERS: Record<AgentProvider, { label: string; buttonLabel: string; description: string; appUrl: string; processName: string }> = {
  copilot: {
    label: 'GitHub Copilot',
    buttonLabel: 'Copilot',
    description: 'Monitor sessions from the GitHub Copilot app.',
    appUrl: 'ghapp://chats',
    processName: 'github.exe',
  },
  codex: {
    label: 'ChatGPT Codex',
    buttonLabel: 'ChatGPT Codex',
    description: 'View local Codex chats and start or control Codex API tasks.',
    appUrl: 'codex://',
    processName: 'ChatGPT.exe',
  },
};
