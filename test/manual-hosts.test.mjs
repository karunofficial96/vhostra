import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm, readdir, chmod, stat } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import os from 'node:os'
import path from 'node:path'
import { HostsFileManager } from '../dist-electron/hosts.js'
const run = promisify(execFile)
const owned = '127.0.0.1 site.test www.site.test # Vhostra 12345678-1234-1234-1234-123456789abc\r\n'
const source = '# Manual comment\r\n127.0.0.1 localhost\r\n::1 localhost ip6-localhost\r\n100.64.0.1 tailscale.test # VPN\r\n192.0.2.1 docker.test # Docker\r\n127.0.0.1 user.test # Vhostra user note\r\n' + owned
const fixture = async task => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vhostra-manual-hosts-'))
  const manager = new HostsFileManager(path.join(root, 'temporary'), path.join(root, 'recovery'))
  manager.hostsPath = path.join(root, 'hosts'); manager.platform = 'linux'
  await writeFile(manager.hostsPath, source); await chmod(manager.hostsPath, 0o640)
  let elevations = 0
  manager.execute = async (_command, args) => { elevations++; await run(args[0], args.slice(1)) }
  try { await task({ manager, root, elevations: () => elevations }) }
  finally { await rm(root, { recursive: true, force: true }) }
}
const save = async (manager, draft, original = source) => { const review = await manager.previewEdit(draft, original); return manager.edit(draft, original, review.id) }

test('manual full-file review changes localhost, IPv6, comments and other applications, with backup and verified native write', () => fixture(async ({ manager, root, elevations }) => {
  assert.deepEqual((await manager.inspect()).managedLines.map(line => line.line), [7])
  const draft = source.replace('# Manual comment', '# Intentionally edited').replace('localhost\r\n', 'localhost loopback.test\r\n').replace('::1 localhost ip6-localhost', '::1 localhost ipv6.test').replace('100.64.0.1 tailscale.test # VPN\r\n', '').replace('192.0.2.1 docker.test', '192.0.2.2 docker.test')
  const review = await manager.previewEdit(draft, source)
  assert.equal(elevations(), 0); assert.equal(await readFile(manager.hostsPath, 'utf8'), source)
  assert.match(review.diff, /-# Manual comment/); assert.match(review.diff, /\+# Intentionally edited/)
  assert.deepEqual(review.managedChanges, [])
  const result = await manager.edit(draft, source, review.id)
  assert.equal(result.contents, draft); assert.equal(elevations(), 1); assert.equal((await stat(manager.hostsPath)).mode & 0o777, 0o640)
  const backup = JSON.parse(await readFile(path.join(root, 'recovery', (await readdir(path.join(root, 'recovery')))[0]), 'utf8'))
  assert.equal(backup.original, source); assert.equal(backup.mode, 'manual'); assert.equal(backup.status, 'completed')
  assert.equal((await stat(path.join(root, 'recovery', (await readdir(path.join(root, 'recovery')))[0]))).mode & 0o777, 0o600)
}))

test('manual deletion/remote replacement warns for owned lines, refreshes missing/conflict and waits for explicit Repair', () => fixture(async ({ manager }) => {
  const draft = source.replace(owned, '192.0.2.5 www.site.test # intentionally remote\r\n')
  const review = await manager.previewEdit(draft, source); assert.match(review.managedChanges[0], /site.test, www.site.test/)
  await manager.edit(draft, source, review.id)
  assert.deepEqual((await manager.mappingStatus(['site.test', 'www.site.test'])).map(row => row.state), ['required', 'conflict'])
  assert.equal(await readFile(manager.hostsPath, 'utf8'), draft)
  await manager.ensureLocalhostMappings(['site.test'])
  assert.equal((await manager.mappingStatus(['site.test']))[0].state, 'mapped')
  assert.ok((await readFile(manager.hostsPath, 'utf8')).startsWith(draft))
  assert.equal((await manager.ensureLocalhostMappings(['www.site.test'])).conflicts.length, 1)
}))

test('manual save requires current, unexpired review bound to exact draft/source; review cancellation is read-only', () => fixture(async ({ manager, elevations }) => {
  const draft = source.replace('Manual comment', 'changed')
  await assert.rejects(manager.edit(draft, source), /Review and explicitly confirm/)
  const review = await manager.previewEdit(draft, source)
  await assert.rejects(manager.edit(draft + '# changed again\r\n', source, review.id), /Review and explicitly confirm/)
  manager.review.expires = 0
  await assert.rejects(manager.edit(draft, source, review.id), /Review and explicitly confirm/)
  assert.equal(elevations(), 0); assert.equal(await readFile(manager.hostsPath, 'utf8'), source)
}))

test('syntax, size and control-byte validation refuse malformed drafts before elevation', () => fixture(async ({ manager, elevations }) => {
  for (const line of ['999.1.1.1 broken.test', '::gg broken.test', '127.0.0.1', '127.0.0.1 -bad.test', '127.0.0.1 example..test', '127.0.0.1 https://site.test']) await assert.rejects(manager.previewEdit(source + line, source), /Invalid Hosts entry on line/)
  for (const draft of [source + '\0', source + '# hidden\u001b', source + '\r', '#'.repeat(1024 * 1024 + 1)]) await assert.rejects(manager.previewEdit(draft, source), /Invalid Hosts content/)
  await assert.rejects(manager.previewEdit(null, source), /Invalid Hosts content/)
  assert.equal(elevations(), 0); assert.equal(await readFile(manager.hostsPath, 'utf8'), source)
}))

test('external changes before preview or after review cannot overwrite the current file and can be reloaded/reviewed', () => fixture(async ({ manager, elevations }) => {
  const draft = source.replace('Manual comment', 'edit')
  const review = await manager.previewEdit(draft, source)
  const external = source + '# external update\r\n'; await writeFile(manager.hostsPath, external)
  await assert.rejects(manager.previewEdit(draft, source), /changed externally.*Reload/)
  await assert.rejects(manager.edit(draft, source, review.id), /changed externally.*Reload/)
  assert.equal(elevations(), 0); assert.equal((await manager.inspect()).contents, external)
  await save(manager, external.replace('Manual comment', 'merged'), external)
  assert.match(await readFile(manager.hostsPath, 'utf8'), /external update/)
}))

test('authentication cancellation and a change during approval leave the file untouched by Vhostra', () => fixture(async ({ manager }) => {
  const draft = source.replace('Manual comment', 'edit')
  manager.execute = async () => { throw Error('Authentication cancelled (-128)') }
  await assert.rejects(save(manager, draft), /cancelled.*Original file is unchanged/s)
  assert.equal(await readFile(manager.hostsPath, 'utf8'), source); assert.equal((await readdir(manager.recoveryDirectory)).length, 0)
  manager.execute = async (_command, args) => { await writeFile(manager.hostsPath, source + '# external during approval\r\n'); await run(args[0], args.slice(1)) }
  await assert.rejects(save(manager, draft), /changed externally/s)
  assert.equal(await readFile(manager.hostsPath, 'utf8'), source + '# external during approval\r\n')
}))

test('failure after atomic write restores original only while target still equals attempted bytes', () => fixture(async ({ manager, root }) => {
  manager.execute = async (_command, args) => {
    const shell = args.at(-1).replace('written=1;', 'written=1; echo "Injected post-write failure" >&2; exit 1;')
    await run('/bin/sh', ['-c', shell])
  }
  await assert.rejects(save(manager, source.replace('Manual comment', 'edited')), /original restored/)
  assert.equal(await readFile(manager.hostsPath, 'utf8'), source)
  assert.ok(!(await readdir(root)).some(name => name.endsWith('.tmp') || name.endsWith('-lock')))
}))

test('verification failure preserves external bytes and both backups for recovery instead of blind rollback', () => fixture(async ({ manager, root }) => {
  const external = '# externally changed after rename\n127.0.0.1 localhost\n'
  manager.execute = async (_command, args) => {
    const changed = path.join(root, 'external'); await writeFile(changed, external)
    const shell = args.at(-1).replace('written=1;', `written=1; cat '${changed}' > '${manager.hostsPath}';`)
    await run('/bin/sh', ['-c', shell])
  }
  await assert.rejects(save(manager, source.replace('Manual comment', 'edited')), /verification failed; backup retained/)
  assert.equal(await readFile(manager.hostsPath, 'utf8'), external)
  const native = (await readdir(root)).find(name => name.endsWith('.bak')); assert.ok(native); assert.equal(await readFile(path.join(root, native), 'utf8'), source)
  const recovery = JSON.parse(await readFile(path.join(root, 'recovery', (await readdir(path.join(root, 'recovery')))[0]), 'utf8'))
  assert.equal(recovery.status, 'failed'); assert.equal(recovery.original, source)
}))

test('automatic ensure/reconcile/delete preserve all unrelated bytes; native guard refuses full-file automatic edits', () => fixture(async ({ manager }) => {
  await assert.rejects(manager.replaceWithElevation(source.replace('Manual comment', 'unsafe'), source), /Automatic Hosts management/)
  await assert.rejects(manager.replaceWithElevation(source + '127.0.0.1 unowned.test\n', source), /may add only Vhostra-owned/)
  await manager.ensureLocalhostMappings(['new.test'])
  await manager.reconcileMappings(['site.test', 'new.test'])
  await manager.removeVhostraMappings(['site.test', 'localhost', 'tailscale.test', 'docker.test', 'user.test', 'ip6-localhost', 'new.test'])
  assert.equal(await readFile(manager.hostsPath, 'utf8'), source.replace(owned, ''))
}))

test('manual diff is bounded and newline-only edits are represented', () => fixture(async ({ manager }) => {
  const ending = await manager.previewEdit(source.trimEnd(), source); assert.match(ending.diff, /No newline at end/)
  const large = await manager.previewEdit('#'.repeat(200000), source); assert.equal(large.truncated, true); assert.equal(large.diff.length, 128 * 1024)
}))

test('manual macOS write uses the same narrowly scoped administrator plan and full-file recovery', () => fixture(async ({ manager }) => {
  manager.platform = 'darwin'
  manager.execute = async (command, args) => {
    assert.equal(command, 'osascript')
    const shell = JSON.parse(args[1].match(/^do shell script (.*) with administrator privileges$/)[1])
    await run('/bin/sh', ['-c', shell])
  }
  const draft = source.replace('Manual comment', 'macOS manual edit')
  assert.equal((await save(manager, draft)).contents, draft)
}))

test('manual Windows confirmation uses encoded UAC child, atomic replacement and guarded verified recovery', () => fixture(async ({ manager }) => {
  manager.platform = 'win32'
  manager.execute = async (command, args) => {
    assert.equal(command, 'powershell.exe')
    assert.match(args.at(-1), /-Verb RunAs -Wait -PassThru/)
    const script = Buffer.from(args.at(-1).match(/'-EncodedCommand','([^']+)'/)[1], 'base64').toString('utf16le')
    assert.match(script, /\$replaced=\$true/); assert.match(script, /\$replaced -and/)
    assert.match(script, /-ceq.*ReadAllBytes/s); assert.match(script, /File\]::Replace/)
    assert.match(script, /Hosts recovery verification failed; backup retained/)
    assert.match(script, /Hosts write verification failed; native backup retained/)
    throw Error('UAC cancelled: 1223')
  }
  await assert.rejects(save(manager, source.replace('Manual comment', 'Windows manual edit')), /1223/)
  assert.equal(await readFile(manager.hostsPath, 'utf8'), source)
}))
