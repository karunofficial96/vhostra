import assert from 'node:assert/strict'
import test from 'node:test'
import { singleRuntimeComposeYaml } from '../dist-electron/runtime.js'

const state = {
  settings: {
    selectedPhpVersion: '8.4', selectedWebServer: 'nginx',
    php: { extensions: [], disabledExtensions: [], cwebpEnabled: false, opcacheEnabled: true },
    ports: { http: 18088, phpMyAdmin: 18089, https: 18443 },
    optionalServices: { redis: false, memcached: false },
  },
  virtualHosts: [], sites: [],
}
const layout = machine => ({
  root: '/synthetic/configuration', dataRoot: '/synthetic/data',
  ...(machine ? { userRoot: '/synthetic/user' } : {}),
  builtinPublic: '/synthetic/data/service-data/localhost/public',
  certificates: { directory: '/synthetic/data/certificates' },
  runtime: {
    openLiteSpeed: '/synthetic/data/runtime/openlitespeed',
    apache: '/synthetic/data/runtime/apache', nginx: '/synthetic/data/runtime/nginx',
    php: '/synthetic/data/runtime/php',
  },
  logs: '/synthetic/logs',
})

test('machine web certificate authority is a read-only mount with an external publisher', () => {
  const machine = singleRuntimeComposeYaml(state, layout(true), 'synthetic', true, 'synthetic-image', 'synthetic-network')
  assert.match(machine, /VHOSTRA_CERTIFICATE_MODE: "external"/)
  assert.match(machine, /\/synthetic\/data\/certificates:\/etc\/vhostra\/certificates:ro/)
  assert.doesNotMatch(machine, /\/synthetic\/data\/certificates:\/etc\/vhostra\/certificates"/)
  const legacy = singleRuntimeComposeYaml(state, layout(false), 'synthetic', true, 'synthetic-image', 'synthetic-network')
  assert.match(legacy, /VHOSTRA_CERTIFICATE_MODE: "managed"/)
  assert.match(legacy, /\/synthetic\/data\/certificates:\/etc\/vhostra\/certificates"/)
})
