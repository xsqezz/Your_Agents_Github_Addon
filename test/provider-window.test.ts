import assert from 'node:assert/strict';
import test from 'node:test';
import { launchProviderApp } from '../src/main/provider-launch.ts';
import { keepWindowVisibleAfterProviderLaunch, type WindowVisibility } from '../src/main/provider-window.ts';

function fakeWindow(initial: { destroyed?: boolean; minimized?: boolean; visible?: boolean } = {}) {
  const state = { destroyed: initial.destroyed ?? false, minimized: initial.minimized ?? false, visible: initial.visible ?? true };
  let restores = 0;
  let inactiveShows = 0;
  const window: WindowVisibility = {
    isDestroyed: () => state.destroyed,
    isMinimized: () => state.minimized,
    isVisible: () => state.visible,
    restore: () => { restores++; state.minimized = false; state.visible = true; },
    showInactive: () => { inactiveShows++; state.visible = true; },
  };
  return { window, state, counts: () => ({ restores, inactiveShows }) };
}

test('provider launch restores a minimized dashboard after the URI handler opens', () => {
  const fake = fakeWindow({ minimized: true, visible: false });
  const scheduled: Array<() => void> = [];
  keepWindowVisibleAfterProviderLaunch(fake.window, (callback) => { scheduled.push(callback); });
  assert.deepEqual(fake.counts(), { restores: 1, inactiveShows: 0 });
  assert.equal(scheduled.length, 2);

  fake.state.minimized = true;
  fake.state.visible = false;
  scheduled[0]();
  assert.deepEqual(fake.counts(), { restores: 2, inactiveShows: 0 });
});

test('provider launch keeps an already visible dashboard in place', () => {
  const fake = fakeWindow();
  const scheduled: Array<() => void> = [];
  keepWindowVisibleAfterProviderLaunch(fake.window, (callback) => { scheduled.push(callback); });
  assert.deepEqual(fake.counts(), { restores: 0, inactiveShows: 0 });

  fake.state.destroyed = true;
  scheduled[0]();
  assert.deepEqual(fake.counts(), { restores: 0, inactiveShows: 0 });
});

for (const [provider, expectedUrl] of [['copilot', 'ghapp://chats'], ['codex', 'codex://']] as const) {
  test(`${provider} provider launch opens its companion and restores UR Agents`, async () => {
    const fake = fakeWindow({ minimized: true, visible: false });
    const scheduled: Array<() => void> = [];
    let openedUrl = '';
    await launchProviderApp(provider, async (url) => { openedUrl = url; }, fake.window, (callback) => { scheduled.push(callback); });
    assert.equal(openedUrl, expectedUrl);
    assert.deepEqual(fake.counts(), { restores: 1, inactiveShows: 0 });
    assert.equal(scheduled.length, 2);
  });
}
