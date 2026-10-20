import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { checkManualUpdate, compareVersions, detectLinuxInstallFormat, releaseAssetName, RELEASE_API } from '../dist-electron/manual-update.js'

const targets = [
  ['win32', 'x64', null, 'windows-x64.exe'], ['win32', 'arm64', null, 'windows-arm64.exe'],
  ['darwin', 'x64', null, 'macos-x64.dmg'], ['darwin', 'arm64', null, 'macos-arm64.dmg'],
  ['linux', 'x64', 'deb', 'linux-amd64.deb'], ['linux', 'arm64', 'deb', 'linux-arm64.deb'],
  ['linux', 'x64', 'rpm', 'linux-x86_64.rpm'], ['linux', 'arm64', 'rpm', 'linux-aarch64.rpm'],
  ['linux', 'x64', 'AppImage', 'linux-x86_64.AppImage'], ['linux', 'arm64', 'AppImage', 'linux-arm64.AppImage'],
]
const asset = (tag, suffix) => {
  const name = `Vhostra-${tag.replace(/^v/, '')}-${suffix}`
  return { name, browser_download_url: `https://github.com/karunofficial96/vhostra/releases/download/${tag}/${name}` }
}
const release = (tag = 'v1.0.9', rest = {}) => new Response(JSON.stringify({
  tag_name: tag, html_url: `https://github.com/karunofficial96/vhostra/releases/tag/${tag}`,
  draft: false, prerelease: false, assets: targets.map(([, , , suffix]) => asset(tag, suffix)), ...rest,
}))
const request = async (url, options) => {
  assert.equal(url, RELEASE_API)
  assert.equal(options.redirect, 'error')
  assert.equal(options.cache, 'no-store')
  return release()
}

test('stable and prerelease versions follow semantic precedence', () => {
  assert.equal(compareVersions('1.0.9', '1.0.8'), 1)
  assert.equal(compareVersions('1.0.9-beta.1', '1.0.8'), 1)
  assert.equal(compareVersions('1.0.9', '1.0.9-beta.1'), 1)
  assert.equal(compareVersions('1.0.9-beta.2', '1.0.9-beta.10'), -1)
  assert.equal(compareVersions('1.0.9', '1.0.9'), 0)
  assert.equal(compareVersions('bad', '1.0.9'), null)
})

test('v1.0.8 and the beta detect v1.0.9; stable reports up to date', async () => {
  for (const version of ['1.0.8', '1.0.9-beta.1']) {
    const result = await checkManualUpdate(version, request, 'darwin', 'arm64')
    assert.equal(result.state, 'available')
    assert.equal(result.availableVersion, 'v1.0.9')
  }
  const current = await checkManualUpdate('1.0.9', request, 'darwin', 'arm64')
  assert.equal(current.state, 'up-to-date')
  assert.match(current.message, /up to date/i)
  assert.equal(current.url, undefined)
})

test('Windows, macOS and Linux links match format and architecture', async () => {
  for (const [platform, arch, format, suffix] of targets) {
    assert.equal(releaseAssetName('v1.0.9', platform, arch, format), `Vhostra-1.0.9-${suffix}`)
    const result = await checkManualUpdate('1.0.8', request, platform, arch, format)
    assert.equal(result.state, 'available', `${platform}/${arch}/${format}`)
    assert.equal(result.url, asset('v1.0.9', suffix).browser_download_url)
    assert.equal(result.choices, undefined)
  }
})

test('Linux format detection requires an AppImage marker or exact package ownership', () => {
  const executable = '/opt/Vhostra/VhostraDesktop'
  const ownedBy = expected => (format, queried) => { assert.equal(queried, executable); return format === expected }
  assert.equal(detectLinuxInstallFormat('/home/user/Vhostra.AppImage', executable, () => false), 'AppImage')
  assert.equal(detectLinuxInstallFormat('/home/user/Vhostra.AppImage', executable, ownedBy('deb')), null)
  assert.equal(detectLinuxInstallFormat(undefined, executable, ownedBy('deb')), 'deb')
  assert.equal(detectLinuxInstallFormat(undefined, executable, ownedBy('rpm')), 'rpm')
  assert.equal(detectLinuxInstallFormat(undefined, executable, () => false), null)
  assert.equal(detectLinuxInstallFormat(undefined, executable, () => true), null)
  assert.equal(detectLinuxInstallFormat(undefined, executable, () => { throw new Error('query failed') }), null)
  assert.equal(detectLinuxInstallFormat(undefined, 'VhostraDesktop', () => { throw new Error('unexpected query') }), null)
})

test('unknown Linux format offers explicit architecture-correct download choices', async () => {
  for (const [arch, names] of [
    ['x64', ['linux-amd64.deb', 'linux-x86_64.rpm', 'linux-x86_64.AppImage']],
    ['arm64', ['linux-arm64.deb', 'linux-aarch64.rpm', 'linux-arm64.AppImage']],
  ]) {
    const result = await checkManualUpdate('1.0.8', request, 'linux', arch)
    assert.equal(result.state, 'choice-required')
    assert.equal(result.url, undefined)
    assert.deepEqual(result.choices.map(choice => choice.url), names.map(name => asset('v1.0.9', name).browser_download_url))
  }
})

test('missing, incompatible and unpublished release assets never produce a download link', async () => {
  const missing = await checkManualUpdate('1.0.8', async () => release('v1.0.9', { assets: [] }), 'linux', 'x64', 'deb')
  assert.equal(missing.state, 'unconfigured')
  assert.equal(missing.url, undefined)
  const incompatible = await checkManualUpdate('1.0.8', async () => release('v1.0.9', { assets: [asset('v1.0.9', 'linux-arm64.deb')] }), 'linux', 'x64')
  assert.equal(incompatible.state, 'unconfigured')
  assert.equal(incompatible.choices, undefined)
  const foreign = await checkManualUpdate('1.0.8', async () => release('v1.0.9', { assets: [{ name: 'Vhostra-1.0.9-windows-x64.exe', browser_download_url: 'https://evil.example/installer.exe' }] }), 'win32', 'x64')
  assert.equal(foreign.state, 'unconfigured')
  assert.equal(foreign.url, undefined)
  assert.equal((await checkManualUpdate('1.0.8', async () => release('bad'))).state, 'invalid')
  assert.equal((await checkManualUpdate('1.0.8', async () => release('v1.0.9', { html_url: 'https://evil.example/update' }))).state, 'invalid')
  assert.equal((await checkManualUpdate('1.0.8', async () => release('v1.0.9', { prerelease: true }))).state, 'invalid')
})

test('offline, timeout and HTTP errors return readable states', async () => {
  assert.equal((await checkManualUpdate('1.0.8', async () => { throw new TypeError('offline') })).state, 'offline')
  assert.equal((await checkManualUpdate('1.0.8', async () => { throw new DOMException('timed out', 'TimeoutError') })).state, 'offline')
  assert.equal((await checkManualUpdate('1.0.8', async () => new Response('{}', { status: 403 }))).state, 'error')
  assert.equal((await checkManualUpdate('1.0.8', async () => new Response('{}', { status: 404 }))).state, 'unconfigured')
})

test('update check exposes links only; opening a download requires a click', async () => {
  const result = await checkManualUpdate('1.0.8', request, 'darwin', 'arm64')
  assert.equal(result.state, 'available')
  assert.equal(typeof result.url, 'string')
  const main = await readFile('electron/main.ts', 'utf8')
  const renderer = await readFile('src/App.tsx', 'utf8')
  assert.match(main, /vhostra:check-for-updates[^\n]*checkForUpdates\(\)/)
  assert.match(renderer, /onClick=\{\(\) => openSite\(update\.url!\)\}/)
  assert.match(renderer, /onClick=\{\(\) => openSite\(choice\.url\)\}/)
})
