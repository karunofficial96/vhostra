import assert from 'node:assert/strict'
import test from 'node:test'
import { configurationOperationMessage, configurationOperations, displayedConfiguration, settledConfiguration } from '../src/configurationPresentation.ts'
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
  }
})

test('cache primary direction is authoritative through normal low-level events', () => {
  for (const service of ['redis', 'memcached']) for (const enabled of [true, false]) {
    const verified = settings('8.3', 'nginx', !enabled, !enabled)
    const requested = { ...verified, optionalServices: { ...verified.optionalServices, [service]: enabled } }
    const operations = configurationOperations(verified, requested)
    assert.deepEqual(operations, [{ kind: 'cache', service: service === 'redis' ? 'Redis' : 'Memcached', direction: enabled ? 'enable' : 'disable' }])
    for (const event of ['Stopping runtime', 'Starting runtime', 'Verifying PHP connectivity']) {
      const primary = configurationOperationMessage(operations) ?? event
      assert.equal(primary, `${enabled ? 'Enabling' : 'Disabling'} ${service === 'redis' ? 'Redis' : 'Memcached'}…`)
    }
  }
})
