import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, writeFile, chmod, rm, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { checkDocker, resolveDockerExecutable, saveDockerExecutable, dockerMessage, knownDockerLocations } from '../dist-electron/docker-prerequisite.js'

test('platform discovery uses bounded conventional Docker paths', () => {
  assert.ok(knownDockerLocations('darwin').includes('/Applications/Docker.app/Contents/Resources/bin/docker'))
  assert.ok(knownDockerLocations('win32', { ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\Sample\\AppData\\Local' }).includes('C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe'))
  assert.ok(knownDockerLocations('linux').includes('/usr/bin/docker'))
  for (const platform of ['darwin', 'win32', 'linux']) assert.ok(knownDockerLocations(platform).length <= 5)
})

test('Docker discovery and daemon outcomes remain distinct without using real Docker', async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'vhostra-docker-check-'))
  const executable = async (name, contents) => {
    const file = path.join(profile, name)
    await writeFile(file, `#!/bin/sh\n${contents}\n`)
    await chmod(file, 0o755)
    return file
  }
  try {
    assert.equal(resolveDockerExecutable(profile, { path: '', known: [] }), undefined)
    assert.equal((await checkDocker(profile, undefined, { path: '', known: [] })).state, 'missing')
    const ready = await executable('ready-docker', 'if [ "$1" = --version ]; then echo Docker version 28.0.0; else echo 28.0.0; fi')
    assert.equal((await checkDocker(undefined, ready)).state, 'ready')
    saveDockerExecutable(profile, ready)
    assert.equal(JSON.parse(await readFile(path.join(profile, 'docker-executable.json'), 'utf8')).path, ready)
    assert.equal(resolveDockerExecutable(profile, { path: '', known: [] }), ready)
    const stopped = await executable('stopped-docker', 'if [ "$1" = --version ]; then echo Docker version 28.0.0; else echo "Cannot connect to the Docker daemon" >&2; exit 1; fi')
    assert.equal((await checkDocker(undefined, stopped)).state, 'stopped')
    const broken = await executable('broken-docker', 'if [ "$1" = --version ]; then echo Docker version 28.0.0; else echo "permission denied" >&2; exit 1; fi')
    assert.equal((await checkDocker(undefined, broken)).state, 'broken')
    const timedOut = await executable('slow-docker', 'if [ "$1" = --version ]; then echo Docker version 28.0.0; else exec sleep 60; fi')
    assert.equal((await checkDocker(undefined, timedOut)).state, 'timeout')
    await assert.rejects(async () => saveDockerExecutable(profile, path.join(profile, 'missing')), /Choose the Docker executable/)
    assert.equal(JSON.parse(await readFile(path.join(profile, 'docker-executable.json'), 'utf8')).path, ready)
    assert.doesNotMatch(dockerMessage({ state: 'missing' }), /ENOENT/)
  } finally { await rm(profile, { recursive: true, force: true }) }
})
