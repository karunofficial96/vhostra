import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { HostsFileManager } from '../dist-electron/hosts.js'

test('hosts status reports mixed loopback and remote addresses as a conflict', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vhostra-hosts-'))
  try {
    const manager = new HostsFileManager(root)
    manager.hostsPath = path.join(root, 'hosts')
    await writeFile(manager.hostsPath, '127.0.0.1 mixed.test\n192.0.2.1 mixed.test\n::1 ipv6.test\n')
    const status = await manager.mappingStatus(['mixed.test', 'ipv6.test', 'missing.test'])
    assert.deepEqual(status.map(item => item.state), ['conflict', 'mapped', 'required'])
    const result = await manager.ensureLocalhostMappings(['mixed.test'])
    assert.equal(result.conflicts[0].address, '192.0.2.1')
    assert.deepEqual((await manager.ensureLocalhostMappings(['ipv6.test'])).alreadyMapped, ['ipv6.test'])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('owned mapping removal preserves other aliases and unowned entries', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vhostra-hosts-'))
  try {
    const manager = new HostsFileManager(root)
    manager.hostsPath = path.join(root, 'hosts')
    await writeFile(manager.hostsPath, '127.0.0.1 removed.test retained.test # Vhostra test\n127.0.0.1 removed.test # user entry\n')
    manager.replaceWithElevation = contents => writeFile(manager.hostsPath, contents)
    await manager.removeVhostraMappings(['removed.test'])
    const contents = await readFile(manager.hostsPath, 'utf8')
    assert.match(contents, /127\.0\.0\.1 retained\.test #Vhostra test/)
    assert.match(contents, /127\.0\.0\.1 removed\.test # user entry/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('reconciliation removes stale owned names while retaining desired and unowned names', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vhostra-hosts-'))
  try {
    const manager = new HostsFileManager(root)
    manager.hostsPath = path.join(root, 'hosts')
    await writeFile(manager.hostsPath, '127.0.0.1 old.test active.test # Vhostra test\n192.0.2.1 untouched.test # user\n')
    manager.replaceWithElevation = contents => writeFile(manager.hostsPath, contents)
    const result = await manager.reconcileMappings(['active.test'])
    assert.deepEqual(result.alreadyMapped, ['active.test'])
    const contents = await readFile(manager.hostsPath, 'utf8')
    assert.doesNotMatch(contents, /old\.test/)
    assert.match(contents, /192\.0\.2\.1 untouched\.test # user/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
