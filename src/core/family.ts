import type { Family } from './types.ts';

export function familyOf(model: string | undefined | null): Family {
  const m = (model ?? '').toLowerCase();
  if (!m) return 'generic';
  if (m.includes('claude')) return 'claude';
  if (m.includes('codex') || m.startsWith('gpt') || /^o\d/.test(m) || m.includes('openai')) return 'gpt';
  if (m.includes('gemini')) return 'gemini';
  if (m.includes('grok')) return 'grok';
  if (m.startsWith('mai')) return 'mai';
  return 'generic';
}

/** 1 = small/fast, 2 = standard, 3 = flagship. Drives accessory/size variants. */
export function tierOf(model: string | undefined | null): number {
  const m = (model ?? '').toLowerCase();
  if (/opus|sol\b|-sol|pro\b|ultra|max|argon/.test(m)) return 3;
  if (/haiku|mini|flash|luna|lite|nano/.test(m)) return 1;
  return 2;
}

export const FAMILY_LABEL: Record<Family, string> = {
  claude: 'Claude',
  gpt: 'GPT / Codex',
  gemini: 'Gemini',
  grok: 'Grok',
  mai: 'MAI',
  generic: 'Model',
};
