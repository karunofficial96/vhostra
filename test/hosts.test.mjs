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
    assert.deepEqual(status.map(item => item.state), ['conflict', 'required', 'required'])
    const result = await manager.ensureLocalhostMappings(['mixed.test'])
    assert.equal(result.conflicts[0].address, '192.0.2.1')
    manager.replaceWithElevation = contents => writeFile(manager.hostsPath, contents)
    assert.deepEqual((await manager.ensureLocalhostMappings(['ipv6.test'])).installed, ['ipv6.test'])
    assert.match(await readFile(manager.hostsPath, 'utf8'), /::1 ipv6.test/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('owned mapping removal preserves other aliases and unowned entries', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vhostra-hosts-'))
  try {
    const manager = new HostsFileManager(root)
    manager.hostsPath = path.join(root, 'hosts')
    await writeFile(manager.hostsPath, '127.0.0.1 removed.test retained.test # Vhostra 00000000-0000-0000-0000-000000000000\n127.0.0.1 removed.test # user entry\n')
    manager.replaceWithElevation = contents => writeFile(manager.hostsPath, contents)
    await manager.removeVhostraMappings(['removed.test'])
    const contents = await readFile(manager.hostsPath, 'utf8')
    assert.match(contents, /127\.0\.0\.1 retained\.test #Vhostra 00000000-0000-0000-0000-000000000000/)
    assert.match(contents, /127\.0\.0\.1 removed\.test # user entry/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('reconciliation removes stale owned names while retaining desired and unowned names', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vhostra-hosts-'))
  try {
    const manager = new HostsFileManager(root)
    manager.hostsPath = path.join(root, 'hosts')
    await writeFile(manager.hostsPath, '127.0.0.1 old.test active.test # Vhostra 00000000-0000-0000-0000-000000000000\n192.0.2.1 untouched.test # user\n')
    manager.replaceWithElevation = contents => writeFile(manager.hostsPath, contents)
    const result = await manager.reconcileMappings(['active.test'])
    assert.deepEqual(result.alreadyMapped, ['active.test'])
    const contents = await readFile(manager.hostsPath, 'utf8')
    assert.doesNotMatch(contents, /old\.test/)
    assert.match(contents, /192\.0\.2\.1 untouched\.test # user/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('writes preserve unrelated CRLF bytes, comments and no-final-newline records', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vhostra-hosts-'))
  try {
    const manager = new HostsFileManager(root); manager.hostsPath = path.join(root, 'hosts')
    const unrelated = '# VPN\r\n\r\n192.0.2.1\tvpn.test # retain spacing\r\n127.0.0.1 manual.test # Vhostra user note\r\n'
    await writeFile(manager.hostsPath, unrelated + '127.0.0.1 old.test # Vhostra 00000000-0000-0000-0000-000000000000\r\n::1 ipv6.test')
    manager.replaceWithElevation = async (contents, expected) => { assert.equal(await readFile(manager.hostsPath, 'utf8'), expected); await writeFile(manager.hostsPath, contents) }
    await manager.removeVhostraMappings(['old.test', 'manual.test'])
    assert.equal(await readFile(manager.hostsPath, 'utf8'), unrelated + '::1 ipv6.test')
    await manager.ensureLocalhostMappings(['new.test'])
    assert.ok((await readFile(manager.hostsPath, 'utf8')).startsWith(unrelated + '::1 ipv6.test\n'))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('failed elevation preserves source and exposes mapping failure for repair', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vhostra-hosts-'))
  try {
    const manager = new HostsFileManager(root); manager.hostsPath = path.join(root, 'hosts')
    const source = '127.0.0.1 existing.test\n'; await writeFile(manager.hostsPath, source)
    manager.replaceWithElevation = async () => { throw Error('User cancelled (-128)') }
    await assert.rejects(manager.ensureLocalhostMappings(['new.test']), /cancelled/)
    assert.equal(await readFile(manager.hostsPath, 'utf8'), source)
    const [status] = await manager.mappingStatus(['new.test'])
    assert.equal(status.state, 'required'); assert.match(status.issue, /Permission cancelled/)
    manager.replaceWithElevation = contents => writeFile(manager.hostsPath, contents)
    await manager.ensureLocalhostMappings(['new.test'])
    assert.equal((await manager.mappingStatus(['new.test']))[0].issue, undefined)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('repair conflict rejects cleanup before any owned mapping mutation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vhostra-hosts-'))
  try {
    const manager = new HostsFileManager(root); manager.hostsPath = path.join(root, 'hosts')
    const source = '192.0.2.1 conflict.test\n127.0.0.1 old.test # Vhostra 00000000-0000-0000-0000-000000000000\n'
    await writeFile(manager.hostsPath, source)
    manager.replaceWithElevation = () => { throw Error('must not write') }
    assert.equal((await manager.reconcileMappings(['conflict.test'])).conflicts.length, 1)
    assert.equal(await readFile(manager.hostsPath, 'utf8'), source)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Linux and macOS elevation plans execute atomic metadata-preserving hosts writes', async () => {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const { chmod, stat, readdir } = await import('node:fs/promises')
  for (const platform of ['linux', 'darwin']) {
    const root = await mkdtemp(path.join(os.tmpdir(), "vhostra-hosts-'quoted-"))
    try {
      const manager = new HostsFileManager(root); manager.platform = platform; manager.hostsPath = path.join(root, 'hosts')
      const original = '# preserve\r\n127.0.0.1 localhost\r\n'; await writeFile(manager.hostsPath, original); await chmod(manager.hostsPath, 0o640)
      manager.execute = async (command, args) => {
        if (platform === 'linux') { assert.equal(command, 'pkexec'); await promisify(execFile)(args[0], args.slice(1)) }
        else { assert.equal(command, 'osascript'); const shell = JSON.parse(args[1].match(/^do shell script (.*) with administrator privileges$/)[1]); await promisify(execFile)('/bin/sh', ['-c', shell]) }
      }
      await manager.ensureLocalhostMappings(['new.test'])
      assert.ok((await readFile(manager.hostsPath, 'utf8')).startsWith(original))
      assert.equal((await stat(manager.hostsPath)).mode & 0o777, 0o640)
      const backup = (await readdir(root)).find(file => file.endsWith('.bak'))
      assert.equal(await readFile(path.join(root, backup), 'utf8'), original)
      await manager.removeVhostraMappings(['new.test'])
      assert.equal(await readFile(manager.hostsPath, 'utf8'), original)
      const expected = original; await writeFile(manager.hostsPath, original + '# external change\n')
      await assert.rejects(manager.replaceWithElevation('unsafe replacement', expected))
      assert.equal(await readFile(manager.hostsPath, 'utf8'), original + '# external change\n')
      assert.ok(!(await readdir(root)).some(file => file.endsWith('.tmp') || file.endsWith('-lock')))
    } finally { await rm(root, { recursive: true, force: true }) }
  }
})

test('Windows elevation uses encoded child command, atomic bytes, backup and verified child exit', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vhostra-hosts-windows-'))
  try {
    const manager = new HostsFileManager(root); manager.platform = 'win32'; manager.hostsPath = path.join(root, 'hosts')
    await writeFile(manager.hostsPath, '# original\n')
    manager.execute = async (command, args) => {
      assert.equal(command, 'powershell.exe')
      const launcher = args.at(-1)
      assert.match(launcher, /-Verb RunAs -Wait -PassThru/); assert.match(launcher, /exit \$child.ExitCode/)
      const encoded = launcher.match(/'-EncodedCommand','([^']+)'/)[1]
      const script = Buffer.from(encoded, 'base64').toString('utf16le')
      assert.match(script, /File\]::Replace/); assert.match(script, /WriteAllBytes/); assert.match(script, /ToBase64String/); assert.match(script, /\.bak/)
      throw Error('Elevation cancelled: 1223')
    }
    await assert.rejects(manager.ensureLocalhostMappings(['new.test']), /1223/)
    assert.equal(await readFile(manager.hostsPath, 'utf8'), '# original\n')
    assert.match((await manager.mappingStatus(['new.test']))[0].issue, /Permission cancelled/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
