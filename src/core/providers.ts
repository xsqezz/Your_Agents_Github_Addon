import type { AgentProvider } from './types.ts';

/** The supported session source and desktop-app launcher. */
export const PROVIDERS: Record<AgentProvider, { label: string; appUrl: string; processName: string }> = {
  copilot: {
    label: 'GitHub Copilot',
    appUrl: 'ghapp://chats',
    processName: 'github.exe',
  },
};
