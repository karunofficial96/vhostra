import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { formatResult, formatStatus, prerequisiteMessage } from '../scripts/cli-format.mjs'
import { redactProgress } from '../dist-electron/progress.js'

const roots = ['status','start','stop','restart','runtime','service','sites','config','database','php','vhost','hosts','import','web','mariadb','redis','memcached','opcache','cwebp','reset']
const invoke = (args, root) => spawnSync(process.execPath, ['scripts/vhostra.mjs', ...args], {
  encoding: 'utf8', timeout: 10000,
  env: { ...process.env, VHOSTRA_USER_DATA: root, VHOSTRA_RUNTIME_PROJECT: `vhostra-cli-audit-${process.pid}` },
})

test('each CLI command family has local help and invalid syntax fails before backend work', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vhostra-cli-help-'))
  try {
    for (const command of roots) {
      const help = invoke([command, '--help'], root)
      assert.equal(help.status, 0, command + help.stderr)
      assert.match(help.stdout, /Usage:/)
    }
    for (const args of [['database','list','extra'], ['runtime','status','extra'], ['sites','edit','id'], ['service','mariadb','enable'], ['php','extension','enable'], ['hosts','repair','name','extra'], ['reset','--force'], ['import','apply']]) {
      const result = invoke(args, root)
      assert.equal(result.status, 64, args.join(' '))
      assert.doesNotMatch(result.stderr, /at .*\.mjs:\d+/)
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('database commands explain a missing MariaDB without a SQL placeholder or stack', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vhostra-cli-missing-db-'))
  try {
    for (const args of [['database','list'], ['database','create','sample','user'], ['database','import','sample','missing.sql'], ['database','export','sample','out.sql'], ['database','repair','sample'], ['database','delete','sample']]) {
      const result = invoke(args, root)
      assert.equal(result.status, 1, args.join(' '))
      assert.match(result.stderr, /MariaDB is Not Created/)
      assert.match(result.stderr, /vhostra mariadb start/)
      assert.doesNotMatch(result.stderr, /SQL value omitted|at .*\.mjs:\d+/)
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('human output excludes backend revisions and secret redaction preserves ordinary names', () => {
  const rendered = formatStatus({ state: 'stopped', serviceRevision: 25, updatedAt: 'private' }, [{ label: 'MariaDB', enabled: true, state: 'stopped' }, { label: 'Redis', enabled: false, state: 'disabled' }])
  assert.match(rendered, /MariaDB\s+Configured: Enabled · Status: Stopped/)
  assert.doesNotMatch(rendered, /serviceRevision|updatedAt|\{/)
  assert.equal(formatResult(['projectdb']), 'projectdb')
  assert.equal(redactProgress('MariaDB service projectdb Site example.test'), 'MariaDB service projectdb Site example.test')
  assert.match(redactProgress('password=private token=abc mysql://user:secret@localhost'), /password=\*+ token=\*+ mysql:\/\/\*+@localhost/)
  for (const [state, expected] of [['not-created','Create and start'], ['stopped','Start it'], ['starting','Wait'], ['disabled','Enable'], ['failed','Check Docker']]) {
    assert.match(prerequisiteMessage('MariaDB', state, 'npm run cli -- mariadb start'), new RegExp(expected))
  }
})
