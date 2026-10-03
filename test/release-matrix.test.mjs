import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, readFile, rm, unlink, lstat } from 'node:fs/promises'
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
    assert.equal(check().status, 0)
    const manifest = JSON.parse(await readFile(path.join(root, 'release-manifest.json'), 'utf8'))
    assert.equal(manifest.artifacts.length, 10)
    assert.equal((await readFile(path.join(root, 'SHA256SUMS'), 'utf8')).trim().split('\n').length, 10)
    await unlink(path.join(root, names[0]))
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
