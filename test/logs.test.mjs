import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, mkdir, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { listPersistentLogs, readLogTail } from '../dist-electron/logs.js'

test('logs return a bounded tail and reject traversal and outside links', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vhostra-logs-'))
  try {
    const logs = path.join(root, 'logs'); await mkdir(logs)
    await writeFile(path.join(logs, 'large.log'), 'a'.repeat(100_000) + 'END')
    await writeFile(path.join(root, 'outside.txt'), 'private')
    await symlink(path.join(root, 'outside.txt'), path.join(logs, 'outside.log'))
    const result = await readLogTail(logs, 'large.log')
    assert.equal(Buffer.byteLength(result.text), 64 * 1024)
    assert.equal(result.truncated, true)
    assert.ok(result.text.endsWith('END'))
    await assert.rejects(readLogTail(logs, '../outside.txt'), /Invalid/)
    await assert.rejects(readLogTail(logs, 'outside.log'), /inside/)
    assert.deepEqual((await listPersistentLogs(logs)).map(file => file.path), ['large.log'])
  } finally { await rm(root, { recursive: true, force: true }) }
})
test('runtime-only log listing stays available beyond many site files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vhostra-logs-filter-'))
  try {
    const sites = path.join(root, 'sites'); await mkdir(sites)
    await Promise.all(Array.from({ length: 110 }, (_, index) => writeFile(path.join(sites, `${index}.log`), 'site')))
    await writeFile(path.join(root, 'runtime.log'), 'runtime')
    assert.deepEqual((await listPersistentLogs(root, false)).map(file => file.path), ['runtime.log'])
  } finally { await rm(root, { recursive: true, force: true }) }
})
