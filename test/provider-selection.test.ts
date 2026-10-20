import assert from 'node:assert/strict';
import test from 'node:test';
import { PROVIDERS } from '../src/core/providers.ts';
import { providerFromClickTarget } from '../src/renderer/provider-selection.ts';

function clickedProvider(provider: string | undefined): Element {
  const button = provider === undefined ? null : { dataset: { provider } };
  return { closest: (selector: string) => selector === '[data-provider]' ? button : null } as unknown as Element;
}

test('clicking the Codex picker or topbar button keeps the Codex identity and URI', () => {
  const selected = providerFromClickTarget(clickedProvider('codex'));
  assert.equal(selected, 'codex');
  assert.equal(PROVIDERS[selected!].appUrl, 'codex://');
});

test('clicking the Copilot picker or topbar button keeps the Copilot identity and URI', () => {
  const selected = providerFromClickTarget(clickedProvider('copilot'));
  assert.equal(selected, 'copilot');
  assert.equal(PROVIDERS[selected!].appUrl, 'ghapp://chats');
});

test('clicks outside provider buttons do not launch either app', () => {
  assert.equal(providerFromClickTarget(clickedProvider(undefined)), null);
  assert.equal(providerFromClickTarget(clickedProvider('unknown')), null);
});
