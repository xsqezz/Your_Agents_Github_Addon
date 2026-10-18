import assert from 'node:assert/strict';
import test from 'node:test';
import { familyOf } from '../src/core/family.ts';

test('family: automatic model selection is its own family', () => {
  assert.equal(familyOf('auto'), 'auto');
  assert.equal(familyOf('Auto'), 'auto');
  assert.equal(familyOf('auto-model'), 'auto');
  assert.equal(familyOf('autopilot-x'), 'generic');
});

test('family: known providers are unchanged', () => {
  assert.equal(familyOf('claude-opus-5'), 'claude');
  assert.equal(familyOf('gpt-5.4'), 'gpt');
  assert.equal(familyOf('gemini-3.8-flash'), 'gemini');
  assert.equal(familyOf('grok-4.7'), 'grok');
  assert.equal(familyOf('mai-code-1.1-flash'), 'mai');
  assert.equal(familyOf(''), 'generic');
});
