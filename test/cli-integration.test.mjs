import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, symlink, readlink, rm, writeFile, readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { ensureOwnedCliLink, removeOwnedCliLink, installAppImageCli, removeAppImageCli } from '../dist-electron/cli-integration.js'

test('CLI link install, reinstall, upgrade and uninstall preserve unrelated commands', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vhostra-cli-link-'))
  const link = path.join(root, 'bin', 'vhostra')
  const target = path.join(root, 'Vhostra.app', 'Contents', 'Resources', 'bin', 'vhostra')
  const other = path.join(root, 'bin', 'git')
  try {
    assert.equal(ensureOwnedCliLink(target, link), 'linked')
    assert.equal(ensureOwnedCliLink(target, link), 'present')
    assert.equal(await readlink(link), target)
    await writeFile(other, 'unrelated')
    assert.equal(removeOwnedCliLink(target, link), true)
    assert.equal(removeOwnedCliLink(target, link), false)
    assert.equal(ensureOwnedCliLink(target, link), 'linked')
    assert.equal(ensureOwnedCliLink(path.join(root, 'Other.app'), link), 'conflict')
    assert.equal(removeOwnedCliLink(path.join(root, 'Other.app'), link), false)
    assert.equal(await readlink(link), target)
    await symlink(target, path.join(root, 'other-link'))
    assert.equal(await readlink(path.join(root, 'other-link')), target)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('AppImage CLI wrapper is explicit, replaceable, and removes only Vhostra-owned content', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vhostra-appimage-cli-'))
  const command = path.join(root, 'bin', 'vhostra')
  try {
    assert.equal(installAppImageCli('/tmp/Vhostra-1.AppImage', command), 'linked')
    assert.match(await readFile(command, 'utf8'), /^#!\/bin\/sh\n# Vhostra-owned AppImage CLI/)
    assert.equal(installAppImageCli('/tmp/Vhostra-2.AppImage', command), 'linked')
    assert.match(await readFile(command, 'utf8'), /Vhostra-2\.AppImage/)
    assert.equal(removeAppImageCli(command), true)
    await writeFile(command, 'other command')
    assert.equal(installAppImageCli('/tmp/Vhostra-3.AppImage', command), 'conflict')
    assert.equal(removeAppImageCli(command), false)
    assert.equal(await readFile(command, 'utf8'), 'other command')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('AppImage CLI passes help through AppRun when user namespaces are unavailable', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vhostra-appimage-run-'))
  const image = path.join(root, 'Vhostra.AppImage')
  const command = path.join(root, 'bin', 'vhostra')
  const cli = path.join(root, 'resources', 'app.asar', 'scripts', 'vhostra.mjs')
  try {
    await mkdir(path.dirname(cli), { recursive: true })
    await writeFile(cli, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))')
    // AppRun prepends --no-sandbox if its namespace probe fails, unless the
    // argument is already present. Node mode rejects a prepended Chromium flag.
    await writeFile(image, '#!/bin/sh\nfor arg do\n  if [ "$arg" = --no-sandbox ]; then exec node "$@"; fi\ndone\nexec node --no-sandbox "$@"\n', { mode: 0o755 })
    assert.equal(installAppImageCli(image, command), 'linked')
    const run = spawnSync(command, ['--help'], { encoding: 'utf8', env: { ...process.env, APPDIR: root } })
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(JSON.parse(run.stdout), ['--help'])
  } finally { await rm(root, { recursive: true, force: true }) }
})
