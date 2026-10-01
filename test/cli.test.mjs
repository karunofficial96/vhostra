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
    const listed = invoke(['vhost', 'list']); assert.equal(listed.status, 0); assert.match(listed.stdout, /localhost/)
    const hosts = invoke(['hosts', 'status']); assert.equal(hosts.status, 0); assert.match(hosts.stdout, /None found/)
    assert.equal(invoke(['hosts', 'repair', 'not-owned.test']).status, 1)
    assert.equal(invoke(['php', 'select', '9.9']).status, 1)
    assert.equal(invoke(['unknown-command']).status, 64)
    const source = path.join(root, 'site.conf'); await writeFile(source, '<VirtualHost *:80>\nServerName cli.test\nDocumentRoot /tmp/cli\n</VirtualHost>')
    const preview = invoke(['import', 'preview', source, 'apache']); assert.equal(preview.status, 0); assert.match(preview.stdout, /Site: cli.test/)
    await writeFile(source, 'server { root /tmp;')
    assert.equal(invoke(['import', 'preview', source, 'nginx']).status, 2)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('interactive CLI reset cancellation at either stage leaves host state unchanged', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vhostra-cli-reset-cancel-'))
  const { VhostraStore } = await import('../dist-electron/store.js'); const store = new VhostraStore(root)
  try {
    const before = JSON.stringify(await store.getState())
    for (const [choice, confirmation] of [['cancel', ''], ['keep', 'No'], ['remove', 'No']]) {
      const result = spawnSync('python3', ['test/cli-reset-pty.py', process.execPath, 'scripts/vhostra.mjs', 'reset'], { encoding: 'utf8', timeout: 20000, env: { ...process.env, VHOSTRA_USER_DATA: root, VHOSTRA_RUNTIME_PROJECT: `vhostra-cli-cancel-${process.pid}`, VHOSTRA_TEST_RESET_CHOICE: choice, VHOSTRA_TEST_RESET_CONFIRM: confirmation } })
      assert.equal(result.status, 0, result.stdout + result.stderr); assert.match(result.stdout, /cancelled/); assert.equal(JSON.stringify(await store.getState()), before)
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})
