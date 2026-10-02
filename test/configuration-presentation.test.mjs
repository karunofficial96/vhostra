import assert from 'node:assert/strict'
import test from 'node:test'
import { beginConfigurationOperation, configurationLifecycleMessage, configurationOperationMessage, configurationOperations, displayedConfiguration, runtimeSecondaryStatus, settledConfiguration } from '../src/configurationPresentation.ts'
import { supportedPhpVersions } from '../src/types/domain.ts'

const servers = ['openlitespeed', 'apache', 'nginx']
const settings = (php = '8.1', server = 'openlitespeed', redis = false, memcached = false) => ({
  selectedPhpVersion: php, selectedWebServer: server, optionalServices: { redis, memcached },
})

test('every PHP request survives an older asynchronous state response and progress before success or rollback', () => {
  for (const from of supportedPhpVersions) for (const to of supportedPhpVersions) {
    if (from === to) continue
    const verified = settings(from)
    const requested = settings(to)
    const staleResponse = { settings: verified, sites: [] }
    assert.equal(displayedConfiguration(staleResponse.settings, requested).selectedPhpVersion, to, `${from} → ${to}: stale response`)
    assert.equal(displayedConfiguration(verified, requested).selectedPhpVersion, to, `${from} → ${to}: progress`)
    const success = settledConfiguration(staleResponse, requested, true)
    assert.equal(displayedConfiguration(success.settings, null).selectedPhpVersion, to, `${from} → ${to}: success`)
    const failure = settledConfiguration(staleResponse, requested, false)
    assert.equal(displayedConfiguration(failure.settings, null).selectedPhpVersion, from, `${from} → ${to}: final rollback`)
  }
})

test('every server request keeps its selector, icon source and Ports & Services labels through an old snapshot', () => {
  for (const from of servers) for (const to of servers) {
    if (from === to) continue
    const verified = settings('8.3', from)
    const requested = settings('8.3', to)
    const shown = displayedConfiguration(verified, requested)
    assert.equal(shown.selectedWebServer, to, `${from} → ${to}: all requested server presentation`)
    assert.equal(settledConfiguration({ settings: verified, sites: [] }, requested, true).settings.selectedWebServer, to)
    assert.equal(settledConfiguration({ settings: verified, sites: [] }, requested, false).settings.selectedWebServer, from)
  }
})

test('Redis and Memcached retain both requested enable and disable states until settlement', () => {
  for (const cache of ['redis', 'memcached']) for (const from of [false, true]) {
    const verified = settings('8.3', 'nginx', from, from)
    const requested = { ...verified, optionalServices: { ...verified.optionalServices, [cache]: !from } }
    assert.equal(displayedConfiguration(verified, requested).optionalServices[cache], !from)
    assert.equal(settledConfiguration({ settings: verified, sites: [] }, requested, true).settings.optionalServices[cache], !from)
    assert.equal(settledConfiguration({ settings: verified, sites: [] }, requested, false).settings.optionalServices[cache], from)
  }
})

test('PHP switch identity and primary direction remain stable through backend lifecycle messages', () => {
  for (const from of supportedPhpVersions) for (const to of supportedPhpVersions) {
    if (from === to) continue
    const operations = configurationOperations(settings(from), settings(to))
    assert.deepEqual(operations, [{ kind: 'php-switch', source: from, target: to }])
    assert.equal(configurationLifecycleMessage(operations[0], 'stopping'), `Stopping PHP ${from}…`)
    assert.equal(configurationLifecycleMessage(operations[0], 'starting'), `Starting PHP ${to}…`)
    assert.equal(configurationLifecycleMessage(operations[0], 'restoring'), `Restoring PHP ${from}…`)
    for (const backendMessage of [`Stopping PHP ${to}`, `Starting PHP ${to}`, 'Verifying candidate runtime']) {
      const primary = configurationOperationMessage(operations) ?? backendMessage
      assert.equal(primary, `Switching PHP from ${from} to ${to}…`)
    }
  }
})

test('all server pairs retain their verified source and requested target', () => {
  for (const from of servers) for (const to of servers) {
    if (from === to) continue
    const operations = configurationOperations(settings('8.3', from), settings('8.3', to))
    assert.deepEqual(operations, [{ kind: 'server-switch', source: from, target: to }])
    const primary = configurationOperationMessage(operations)
    assert.match(primary, /^Switching web server from .+ to .+…$/)
    assert.doesNotMatch(primary, new RegExp(`Stopping ${to}`, 'i'))
    const names = { openlitespeed: 'OpenLiteSpeed', apache: 'Apache', nginx: 'Nginx' }
    assert.equal(configurationLifecycleMessage(operations[0], 'stopping'), `Stopping ${names[from]}…`)
    assert.equal(configurationLifecycleMessage(operations[0], 'starting'), `Starting ${names[to]}…`)
  }
})

test('cache primary direction is authoritative through normal low-level events', () => {
  for (const service of ['redis', 'memcached']) for (const enabled of [true, false]) {
    const verified = settings('8.3', 'nginx', !enabled, !enabled)
    const requested = { ...verified, optionalServices: { ...verified.optionalServices, [service]: enabled } }
    const operations = configurationOperations(verified, requested)
    assert.deepEqual(operations, [{ kind: 'cache', service: service === 'redis' ? 'Redis' : 'Memcached', direction: enabled ? 'enable' : 'disable' }])
    assert.equal(configurationLifecycleMessage(operations[0], 'starting'), `${enabled ? 'Enabling' : 'Disabling'} ${service === 'redis' ? 'Redis' : 'Memcached'}…`)
    assert.equal(configurationLifecycleMessage(operations[0], 'restoring'), `Restoring previous ${service === 'redis' ? 'Redis' : 'Memcached'} configuration…`)
    for (const event of ['Stopping runtime', 'Starting runtime', 'Verifying PHP connectivity']) {
      const primary = configurationOperationMessage(operations) ?? event
      assert.equal(primary, `${enabled ? 'Enabling' : 'Disabling'} ${service === 'redis' ? 'Redis' : 'Memcached'}…`)
    }
  }
})

test('captured intent survives old and candidate observations and remains distinct per operation', () => {
  const old = settings('8.1', 'openlitespeed')
  const requested = settings('8.3', 'nginx')
  const active = beginConfigurationOperation(41, old, requested)
  const initial = structuredClone(active)
  for (const observation of [old, requested, settings('8.5', 'apache')]) {
    assert.equal(displayedConfiguration(observation, requested).selectedPhpVersion, '8.3')
    assert.deepEqual(active, initial)
    assert.equal(configurationOperationMessage(active.intent), 'Switching PHP from 8.1 to 8.3 · Switching web server from OpenLiteSpeed to Nginx…')
  }
  const next = beginConfigurationOperation(42, requested, old)
  assert.notEqual(next.id, active.id)
  assert.equal(active.intent[0].source, '8.1')
  assert.equal(next.intent[0].source, '8.3')
})

test('secondary runtime output uses source while stopping and target while starting for every PHP and server pair', () => {
  const snapshot = state => ({ state, message: 'Injected phase', services: [], updatedAt: '' })
  const names = { openlitespeed: 'OpenLiteSpeed', apache: 'Apache', nginx: 'Nginx' }
  for (const from of supportedPhpVersions) for (const to of supportedPhpVersions) {
    if (from === to) continue
    const source = settings(from)
    const target = settings(to)
    const operation = beginConfigurationOperation(1, source, target)
    assert.equal(runtimeSecondaryStatus(snapshot('stopping'), operation, target), `Stopping · OpenLiteSpeed · PHP ${from}`)
    assert.equal(runtimeSecondaryStatus(snapshot('starting'), operation, source), `Starting · OpenLiteSpeed · PHP ${to}`)
    assert.equal(runtimeSecondaryStatus({ ...snapshot('starting'), replacementPhase: 'restoring' }, operation, target), `Restoring · OpenLiteSpeed · PHP ${from}`)
  }
  for (const from of servers) for (const to of servers) {
    if (from === to) continue
    const source = settings('8.1', from)
    const target = settings('8.3', to)
    const operation = beginConfigurationOperation(2, source, target)
    assert.equal(runtimeSecondaryStatus(snapshot('stopping'), operation, target), `Stopping · ${names[from]} · PHP 8.1`)
    assert.equal(runtimeSecondaryStatus(snapshot('starting'), operation, source), `Starting · ${names[to]} · PHP 8.3`)
  }
})

test('cache intent retains direction while secondary stop and start describe their configuration sides', () => {
  const snapshot = state => ({ state, message: 'Injected phase', services: [], updatedAt: '' })
  for (const service of ['redis', 'memcached']) for (const enabled of [true, false]) {
    const source = settings('8.1', 'openlitespeed', !enabled, !enabled)
    const target = settings('8.1', 'openlitespeed', enabled, enabled)
    const operation = beginConfigurationOperation(3, source, target)
    assert.equal(operation.sourceConfiguration.optionalServices[service], !enabled)
    assert.equal(operation.targetConfiguration.optionalServices[service], enabled)
    assert.match(configurationOperationMessage(operation.intent), new RegExp(`${enabled ? 'Enabling' : 'Disabling'} ${service === 'redis' ? 'Redis' : 'Memcached'}`))
    assert.equal(runtimeSecondaryStatus(snapshot('stopping'), operation, target), 'Stopping · OpenLiteSpeed · PHP 8.1')
    assert.equal(runtimeSecondaryStatus(snapshot('starting'), operation, source), 'Starting · OpenLiteSpeed · PHP 8.1')
  }
})
