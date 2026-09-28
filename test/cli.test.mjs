import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
test('CLI lists canonical state, previews native files, validates ownership and returns useful exit codes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vhostra-cli-contract-'))
  const invoke = args => spawnSync(process.execPath, ['scripts/vhostra.mjs', ...args], { encoding: 'utf8', env: { ...process.env, VHOSTRA_USER_DATA: root, VHOSTRA_RUNTIME_PROJECT: `vhostra-cli-contract-${process.pid}` }, timeout: 10000 })
  try {
    const listed = invoke(['vhost', 'list']); assert.equal(listed.status, 0); assert.equal(JSON.parse(listed.stdout)[0].hostname, 'localhost')
    const hosts = invoke(['hosts', 'status']); assert.equal(hosts.status, 0); assert.deepEqual(JSON.parse(hosts.stdout), [])
    assert.equal(invoke(['hosts', 'repair', 'not-owned.test']).status, 1)
    assert.equal(invoke(['php', 'select', '9.9']).status, 1)
    assert.equal(invoke(['unknown-command']).status, 64)
    const source = path.join(root, 'site.conf'); await writeFile(source, '<VirtualHost *:80>\nServerName cli.test\nDocumentRoot /tmp/cli\n</VirtualHost>')
    const preview = invoke(['import', 'preview', source, 'apache']); assert.equal(preview.status, 0); assert.equal(JSON.parse(preview.stdout).hosts[0].hostname, 'cli.test')
    await writeFile(source, 'server { root /tmp;')
    assert.equal(invoke(['import', 'preview', source, 'nginx']).status, 2)
  } finally { await rm(root, { recursive: true, force: true }) }
})
