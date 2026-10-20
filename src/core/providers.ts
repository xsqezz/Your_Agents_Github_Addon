import type { AgentProvider } from './types.ts';

/** Add a provider here when its source and official desktop-app launcher are implemented. */
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
    description: 'Monitor local Codex and Worktree tasks from ChatGPT.',
    appUrl: 'codex://',
    processName: 'ChatGPT.exe',
  },
};
