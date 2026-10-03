import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, unlink, lstat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

test('release gate requires every architecture and writes checksums only for a full matrix', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vhostra-release-gate-'))
  const script = path.resolve('scripts/verify-release.mjs')
  const names = ['windows-x64.exe', 'windows-arm64.exe', 'macos-x64.dmg', 'macos-arm64.dmg', 'linux-x86_64.rpm', 'linux-aarch64.rpm', 'linux-amd64.deb', 'linux-arm64.deb', 'linux-x86_64.AppImage', 'linux-arm64.AppImage'].map(suffix => `Vhostra-1.0.0-${suffix}`)
  const check = () => spawnSync(process.execPath, [script, root, '1.0.0', 'all'], { encoding: 'utf8' })
  try {
    for (const name of names) await writeFile(path.join(root, name), name)
    await writeFile(path.join(root, 'unexpected.txt'), 'unexpected')
    assert.notEqual(check().status, 0)
    await unlink(path.join(root, 'unexpected.txt'))
    assert.equal(check().status, 0)
    const manifest = JSON.parse(await readFile(path.join(root, 'release-manifest.json'), 'utf8'))
    assert.equal(manifest.artifacts.length, 10)
    assert.equal((await readFile(path.join(root, 'SHA256SUMS'), 'utf8')).trim().split('\n').length, 10)
    await unlink(path.join(root, names[0]))
    assert.notEqual(check().status, 0)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('release artifact merge rejects missing, unexpected, and duplicate inputs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vhostra-release-merge-'))
  const source = path.join(root, 'downloads')
  const destination = path.join(root, 'release-assets')
  const script = path.resolve('scripts/merge-release-artifacts.mjs')
  const labels = ['windows-x64', 'windows-arm64', 'macos-x64', 'macos-arm64', 'linux-x64', 'linux-arm64']
  const check = () => spawnSync(process.execPath, [script, source, destination], { encoding: 'utf8' })
  try {
    await mkdir(source)
    for (const label of labels) {
      const directory = path.join(source, `vhostra-${label}`)
      await mkdir(directory)
      await writeFile(path.join(directory, `${label}.exe`), label)
    }
    assert.equal(check().status, 0)
    assert.equal((await readdir(destination)).length, 6)
    await rm(destination, { recursive: true })
    await writeFile(path.join(source, 'vhostra-windows-arm64', 'windows-x64.exe'), 'duplicate')
    assert.notEqual(check().status, 0)
    await rm(destination, { recursive: true })
    await unlink(path.join(source, 'vhostra-windows-arm64', 'windows-x64.exe'))
    await mkdir(path.join(source, 'vhostra-unexpected'))
    assert.notEqual(check().status, 0)
    await rm(path.join(source, 'vhostra-unexpected'), { recursive: true })
    await rm(path.join(source, 'vhostra-linux-arm64'), { recursive: true })
    assert.notEqual(check().status, 0)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Windows unpacked executable must have the requested PE architecture', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vhostra-win-pe-'))
  const script = path.resolve('scripts/verify-release.mjs')
  try {
    await writeFile(path.join(root, 'Vhostra-1.0.0-windows-arm64.exe'), 'installer fixture')
    const unpacked = path.join(root, 'win-arm64-unpacked')
    await mkdir(unpacked)
    await writeFile(path.join(unpacked, 'vhostra.cmd'), '@echo off')
    const exe = Buffer.alloc(512)
    exe.writeUInt32LE(0x80, 0x3c)
    exe.writeUInt16LE(0xaa64, 0x84)
    await writeFile(path.join(unpacked, 'Vhostra.exe'), exe)
    const check = () => spawnSync(process.execPath, [script, root, '1.0.0', 'win', 'arm64'], { encoding: 'utf8' })
    assert.equal(check().status, 0)
    exe.writeUInt16LE(0x8664, 0x84)
    await writeFile(path.join(unpacked, 'Vhostra.exe'), exe)
    assert.notEqual(check().status, 0)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('bundled license texts are regular files for Windows NSIS compression', async () => {
  const licenses = [
    'common/GFDL', 'common/GPL', 'common/LGPL',
    'mariadb/openssl/copyright', 'web/openssl/copyright',
  ]
  for (const license of licenses) {
    const file = path.resolve('third-party-licenses/docker', license)
    assert.equal((await lstat(file)).isFile(), true, `${license} must not be a symlink`)
    assert.ok((await readFile(file)).length > 100, `${license} must contain the license text`)
  }
})
