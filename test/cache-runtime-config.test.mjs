import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { cacheRuntimePath, renderCacheRuntimeConfig } from '../dist-electron/cache-runtime-config.js'

test('machine cache config uses fixed generated paths and keeps both caches ephemeral', async () => {
  const dataRoot = '/private/tmp/vhostra-synthetic-machine'
  const layout = { dataRoot, runtime: { redis: path.join(dataRoot, 'service-data/redis'), memcached: path.join(dataRoot, 'service-data/memcached') } }
  assert.equal(cacheRuntimePath(layout, 'redis'), path.join(dataRoot, 'runtime-config/cache/redis.conf'))
  assert.equal(cacheRuntimePath(layout, 'memcached'), path.join(dataRoot, 'runtime-config/cache/memcached.conf'))
  const config = renderCacheRuntimeConfig(6381, 11212)
  assert.match(config.redis, /^# Vhostra container cache configuration; owner=vhostra; schema=1\n/)
  assert.match(config.redis, /appendonly no\nsave ""/)
  assert.match(config.redis, /port 6381\n$/)
  assert.match(config.memcached, /-u nobody\n-l 127\.0\.0\.1/)
  assert.match(config.memcached, /-p 11212\n$/)
  for (const value of Object.values(config)) assert.doesNotMatch(value, /password|secret|token|\.\.\//i)
  for (const port of [0, 65536, NaN, 6381.5, '6381']) assert.throws(() => renderCacheRuntimeConfig(port, 11212), /Invalid cache service port/)
  const supervisor = await readFile(new URL('../runtime-image/supervisor.conf', import.meta.url), 'utf8')
  assert.match(supervisor, /\[program:redis\]\ncommand=redis-server[^\n]*\nuser=redis\n/)
  assert.match(supervisor, /\[program:memcached\]\ncommand=.*grep -v/)
})
