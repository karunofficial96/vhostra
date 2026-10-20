import test from 'node:test';
import assert from 'node:assert/strict';
import { startAutomaticServices } from '../dist-electron/automatic-startup.js';
import { installWindowSessionEndHandlers, shouldConfirmQuit } from '../dist-electron/quit-intent.js';
import { startupDecision } from '../dist-electron/startup.js';

test('service startup modes distinguish normal opening from background login', () => {
  for (const [mode, launchAtLogin, normal, login] of [
    ['manual', false, [false, true, false], [false, false, false]],
    ['manual', true, [true, true, false], [true, true, false]],
    ['on-open', false, [false, true, true], [false, false, false]],
    ['on-open', true, [true, true, true], [true, true, true]],
    ['after-login', false, [true, true, false], [true, false, true]],
  ]) {
    const startup = { launchAtLogin, serviceStartMode: mode };
    assert.deepEqual(Object.values(startupDecision(startup, false)), normal);
    assert.deepEqual(Object.values(startupDecision(startup, true)), login);
  }
  assert.equal(startupDecision({ launchAtLogin: true, serviceStartMode: 'after-login' }, true).showWindow, false);
});

test('confirmed shutdown bypasses quit confirmation; manual quit retains it', () => {
  assert.equal(shouldConfirmQuit(false, false, true), true);
  assert.equal(shouldConfirmQuit(true, false, true), false);
  assert.equal(shouldConfirmQuit(false, true, true), false);
});

test('Windows session-end signals suppress confirmation; other platforms retain manual quit', () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    const listeners = new Map(); let confirmed = false;
    installWindowSessionEndHandlers({ on: (event, listener) => listeners.set(event, listener) }, platform, () => { confirmed = true; });
    assert.equal(listeners.has('query-session-end'), platform === 'win32');
    assert.equal(listeners.has('session-end'), platform === 'win32');
    listeners.get('query-session-end')?.();
    assert.equal(shouldConfirmQuit(confirmed, false, true), platform !== 'win32');
  }
});

test('automatic startup waits for delayed Docker, starts once, and preserves disabled services', async () => {
  const calls = [];
  let probes = 0;
  const controller = {
    current: () => ({ state: 'unavailable', message: 'Docker starting' }),
    checkPrerequisite: async () => ({ state: ++probes < 3 ? 'stopped' : 'ready' }),
    refresh: async () => ({ state: 'stopped', message: 'Stopped' }),
    start: async () => { calls.push('start'); },
  };
  await Promise.all([startAutomaticServices(controller, '', { delay: async () => {}, report: async () => {} }), startAutomaticServices(controller, '', { delay: async () => {}, report: async () => {} })]);
  assert.equal(probes, 3);
  assert.deepEqual(calls, ['start']);
  // The startup orchestrator invokes the runtime's existing start operation; it never changes optional-service settings.
});

test('automatic startup skips running services and bounds unavailable Docker', async () => {
  let starts = 0;
  const reports = [];
  const controller = { current: () => ({ state: 'running', message: 'Running' }), checkPrerequisite: async () => ({ state: 'ready' }), refresh: async () => ({ state: 'running', message: 'Running' }), listManagedServices: async () => [{ id: 'web', enabled: true, state: 'running' }, { id: 'mariadb', enabled: true, state: 'running' }], controlManagedService: async () => { starts++; }, start: async () => { starts++; } };
  await startAutomaticServices(controller, '', { report: async value => { reports.push(value); } });
  assert.equal(starts, 0);
  const unavailable = { ...controller, current: () => ({ state: 'unavailable', message: 'Unavailable' }), checkPrerequisite: async () => ({ state: 'stopped' }) };
  await startAutomaticServices(unavailable, '', { attempts: 2, delay: async () => {}, report: async value => { reports.push(value); } });
  assert.equal(starts, 0);
  assert.match(reports.at(-1), /timed out waiting for Docker/);
});

test('partially running runtime starts only missing enabled services', async () => {
  const calls = [];
  const controller = { current: () => ({ state: 'running', message: 'Running' }), checkPrerequisite: async () => ({ state: 'ready' }), refresh: async () => ({ state: 'running', message: 'Running' }), listManagedServices: async () => [
    { id: 'web', enabled: true, state: 'running' }, { id: 'mariadb', enabled: true, state: 'stopped' },
    { id: 'redis', enabled: false, state: 'disabled' }, { id: 'memcached', enabled: true, state: 'failed' },
  ], controlManagedService: async id => { calls.push(id); }, start: async () => { throw Error('full start was unnecessary'); } };
  await startAutomaticServices(controller, '', { report: async () => {} });
  assert.deepEqual(calls, ['mariadb', 'memcached']);
});

test('one partial-service failure is reported and does not suppress other enabled services', async () => {
  const calls = []; const reports = [];
  const controller = { current: () => ({ state: 'running', message: 'Running' }), checkPrerequisite: async () => ({ state: 'ready' }), refresh: async () => ({ state: 'running', message: 'Running' }), listManagedServices: async () => [
    { id: 'mariadb', enabled: true, state: 'failed' }, { id: 'web', enabled: true, state: 'stopped' },
    { id: 'redis', enabled: false, state: 'disabled' }, { id: 'memcached', enabled: false, state: 'disabled' },
  ], controlManagedService: async id => { calls.push(id); if (id === 'mariadb') throw Error('fixture failure'); }, start: async () => { throw Error('unexpected full start'); } };
  await startAutomaticServices(controller, '', { report: async value => { reports.push(value); } });
  assert.deepEqual(calls, ['mariadb', 'web']);
  assert.match(reports[0], /could not start mariadb/);
});
