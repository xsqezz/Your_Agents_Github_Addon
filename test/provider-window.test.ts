import assert from 'node:assert/strict';
import test from 'node:test';
import { launchProviderApp } from '../src/main/provider-launch.ts';
import { keepWindowVisibleAfterProviderLaunch, type WindowVisibility } from '../src/main/provider-window.ts';

function fakeWindow(initial: { destroyed?: boolean; minimized?: boolean; visible?: boolean } = {}) {
  const state = { destroyed: initial.destroyed ?? false, minimized: initial.minimized ?? false, visible: initial.visible ?? true };
  let restores = 0;
  let inactiveShows = 0;
  let focuses = 0;
  const listeners = new Map<string, Set<() => void>>();
  const window: WindowVisibility = {
    isDestroyed: () => state.destroyed,
    isMinimized: () => state.minimized,
    isVisible: () => state.visible,
    restore: () => { restores++; state.minimized = false; state.visible = true; },
    showInactive: () => { inactiveShows++; state.visible = true; },
    focus: () => { focuses++; },
    on: (event, listener) => {
      const set = listeners.get(event) ?? new Set<() => void>();
      set.add(listener);
      listeners.set(event, set);
    },
    removeListener: (event, listener) => { listeners.get(event)?.delete(listener); },
  };
  return {
    window,
    state,
    counts: () => ({ restores, inactiveShows, focuses }),
    emit: (event: 'hide' | 'minimize') => { for (const listener of listeners.get(event) ?? []) listener(); },
  };
}

test('provider launch restores a minimized dashboard and watches delayed hides', () => {
  const fake = fakeWindow({ minimized: true, visible: false });
  const scheduled: Array<() => void> = [];
  const delays: number[] = [];
  keepWindowVisibleAfterProviderLaunch(fake.window, (callback, delay) => { scheduled.push(callback); delays.push(delay); });
  assert.deepEqual(fake.counts(), { restores: 1, inactiveShows: 0, focuses: 1 });
  assert.deepEqual(delays, [250, 1000, 2500, 5000, 8000, 10000]);

  fake.state.minimized = true;
  fake.state.visible = false;
  fake.emit('minimize');
  assert.deepEqual(fake.counts(), { restores: 2, inactiveShows: 0, focuses: 2 });

  fake.state.visible = false;
  fake.emit('hide');
  assert.deepEqual(fake.counts(), { restores: 2, inactiveShows: 1, focuses: 3 });

  scheduled[4]();
  fake.state.visible = false;
  fake.emit('hide');
  assert.deepEqual(fake.counts(), { restores: 2, inactiveShows: 2, focuses: 5 });
});

test('provider launch keeps an already visible dashboard in place', () => {
  const fake = fakeWindow();
  const scheduled: Array<() => void> = [];
  const delays: number[] = [];
  keepWindowVisibleAfterProviderLaunch(fake.window, (callback, delay) => { scheduled.push(callback); delays.push(delay); });
  assert.deepEqual(fake.counts(), { restores: 0, inactiveShows: 0, focuses: 1 });

  fake.state.destroyed = true;
  scheduled[0]();
  assert.deepEqual(fake.counts(), { restores: 0, inactiveShows: 0, focuses: 1 });
  scheduled[4]();
  fake.emit('hide');
  assert.equal(delays.length, 6);
});

for (const [provider, expectedUrl] of [['copilot', 'ghapp://chats'], ['codex', 'codex://']] as const) {
  test(`${provider} provider launch opens its companion and restores UR Agents`, async () => {
    const fake = fakeWindow({ minimized: true, visible: false });
    const scheduled: Array<() => void> = [];
    const delays: number[] = [];
    let openedUrl = '';
    await launchProviderApp(provider, async (url) => {
      openedUrl = url;
      fake.state.visible = false;
      fake.emit('hide');
    }, fake.window, (callback, delay) => { scheduled.push(callback); delays.push(delay); }, () => false);
    assert.equal(openedUrl, expectedUrl);
    assert.deepEqual(fake.counts(), { restores: 1, inactiveShows: 1, focuses: 3 });
    assert.deepEqual(delays, [250, 1000, 2500, 5000, 8000, 10000]);
    assert.equal(scheduled.length, 6);
  });
}

test('when provider is already running, leave it untouched and focus UR Agents', async () => {
  const fake = fakeWindow();
  let opened = false;
  await launchProviderApp('codex', async () => { opened = true; }, fake.window, undefined, () => true);
  assert.equal(opened, false);
  assert.deepEqual(fake.counts(), { restores: 0, inactiveShows: 0, focuses: 1 });
});

test('when provider is closed, launch it and keep UR Agents focused', async () => {
  const fake = fakeWindow();
  let openedUrl = '';
  await launchProviderApp('copilot', async (url) => { openedUrl = url; }, fake.window, undefined, () => false);
  assert.equal(openedUrl, 'ghapp://chats');
  assert.ok(fake.counts().focuses >= 2);
});
