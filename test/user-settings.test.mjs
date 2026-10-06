import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { VhostraStore } from '../dist-electron/store.js'

test('startup preferences stay with each OS account while environment settings are shared', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vhostra-users-'))
  const shared = path.join(root, 'shared')
  const users = [path.join(root, 'alice'), path.join(root, 'bob')]
  try {
    await mkdir(shared)
    for (const user of users) {
      await mkdir(user)
      await writeFile(path.join(user, 'vhostra-location.json'), JSON.stringify({ root: shared }))
    }
    const alice = new VhostraStore(users[0])
    const bob = new VhostraStore(users[1])
    const first = await alice.getState()
    await alice.saveSettings({ ...first.settings, selectedWebServer: 'nginx', startup: { launchAtLogin: false, serviceStartMode: 'manual', closeBehavior: 'keep-services' } })
    const second = await bob.getState()
    assert.equal(second.settings.selectedWebServer, 'nginx')
    assert.equal(second.settings.startup.serviceStartMode, 'on-open')
    await bob.saveSettings({ ...second.settings, startup: { launchAtLogin: true, serviceStartMode: 'after-login', closeBehavior: 'stop-services' } })
    assert.equal((await alice.getState()).settings.startup.serviceStartMode, 'manual')
    assert.equal((await bob.getState()).settings.startup.serviceStartMode, 'after-login')
    assert.equal('startup' in JSON.parse(await readFile(path.join(shared, 'settings.json'), 'utf8')), false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('legacy startup is copied to personal settings without changing shared choices', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vhostra-legacy-user-'))
  try {
    const store = new VhostraStore(root)
    const state = await store.getState()
    await writeFile(store.layout.settings, JSON.stringify({ ...state.settings, startup: { launchAtLogin: false, serviceStartMode: 'manual', closeBehavior: 'keep-services' } }))
    await rm(path.join(root, 'vhostra-user-settings.json'))
    assert.equal((await new VhostraStore(root).getState()).settings.startup.serviceStartMode, 'manual')
    assert.equal('startup' in JSON.parse(await readFile(store.layout.settings, 'utf8')), false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('legacy completed onboarding and theme stay completed for the original account', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vhostra-legacy-onboarding-'))
  try {
    const store = new VhostraStore(root)
    await store.getState()
    await writeFile(path.join(store.layout.root, 'onboarding.json'), JSON.stringify({ completed: true, ready: true, theme: 'dark', server: 'apache', php: '8.4', cache: 'none' }))
    const upgraded = await new VhostraStore(root).getOnboarding()
    assert.equal(upgraded.completed, true)
    assert.equal(upgraded.secondary, false)
    assert.equal(upgraded.theme, 'dark')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('first account sets up the machine and a second account gets personal welcome once', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vhostra-secondary-'))
  const shared = path.join(root, 'shared')
  const users = [path.join(root, 'first'), path.join(root, 'second')]
  try {
    await mkdir(shared)
    for (const user of users) {
      await mkdir(user)
      await writeFile(path.join(user, 'vhostra-location.json'), JSON.stringify({ root: shared }))
    }
    const first = new VhostraStore(users[0])
    const second = new VhostraStore(users[1])
    assert.equal((await first.getOnboarding()).secondary, false)
    assert.equal((await first.getOnboarding()).completed, false)
    await first.saveOnboarding({ ...await first.getOnboarding(), ready: true, theme: 'dark' })
    await first.finishOnboarding()
    const newUser = await second.getOnboarding()
    assert.equal(newUser.secondary, true)
    assert.equal(newUser.completed, false)
    assert.equal(newUser.theme, 'system')
    await second.saveOnboarding({ ...newUser, theme: 'light' })
    assert.equal((await first.getOnboarding()).theme, 'dark')
    await second.finishOnboarding()
    assert.equal((await new VhostraStore(users[1]).getOnboarding()).completed, true)
    assert.equal((await new VhostraStore(users[1]).getOnboarding()).secondary, false)
    assert.equal((await first.getOnboarding()).theme, 'dark')
    const sharedBefore = await readFile(path.join(shared, 'settings.json'), 'utf8')
    await second.resetUserPreferences()
    assert.equal((await second.getOnboarding()).theme, 'system')
    assert.equal((await second.getOnboarding()).completed, true)
    assert.equal((await first.getOnboarding()).theme, 'dark')
    assert.equal(await readFile(path.join(shared, 'settings.json'), 'utf8'), sharedBefore)
  } finally { await rm(root, { recursive: true, force: true }) }
})
