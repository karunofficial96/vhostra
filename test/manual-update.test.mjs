import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkManualUpdate, compareVersions, releaseAssetName, RELEASE_API } from '../dist-electron/manual-update.js'

const release = (tag_name, rest = {}) => new Response(JSON.stringify({ tag_name, html_url: `https://github.com/karunofficial96/vhostra/releases/tag/${tag_name}`, draft: false, prerelease: false, assets: [{ name: 'Vhostra-1.1.0-macos-arm64.dmg', browser_download_url: `https://github.com/karunofficial96/vhostra/releases/download/${tag_name}/Vhostra-1.1.0-macos-arm64.dmg` }], ...rest }), { status: 200 })

test('semantic versions include prerelease precedence', () => {
  assert.equal(compareVersions('1.0.1', '1.0.0'), 1)
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0)
  assert.equal(compareVersions('1.0.0-rc.2', '1.0.0-rc.10'), -1)
  assert.equal(compareVersions('1.0.0', '1.0.0-rc.10'), 1)
  assert.equal(compareVersions('bad', '1.0.0'), null)
})

test('manual update checks use the fixed release source only when called', async () => {
  let calls = 0
  const request = async (url, options) => {
    calls++
    assert.equal(url, RELEASE_API)
    assert.equal(options.redirect, 'error')
    assert.equal(options.cache, 'no-store')
    return release('v1.1.0')
  }
  assert.equal(calls, 0)
  const result = await checkManualUpdate('1.0.0', request, 'darwin', 'arm64')
  assert.equal(calls, 1)
  assert.equal(result.state, 'available')
  assert.match(result.url, /github\.com\/karunofficial96\/vhostra\/releases/)
  assert.equal((await checkManualUpdate('1.1.0', request, 'darwin', 'arm64')).state, 'up-to-date')
  assert.equal(releaseAssetName('v1.2.0', 'win32', 'arm64'), 'Vhostra-1.2.0-windows-arm64.exe')
  assert.equal(releaseAssetName('1.2.0', 'linux', 'x64', 'rpm'), 'Vhostra-1.2.0-linux-x86_64.rpm')
  assert.equal(releaseAssetName('1.2.0', 'linux', 'arm64', 'deb'), 'Vhostra-1.2.0-linux-arm64.deb')
  assert.equal((await checkManualUpdate('1.0.0', request, 'win32', 'arm64')).state, 'unconfigured')
})

test('malformed, unpublished and offline results are bounded and readable', async () => {
  assert.equal((await checkManualUpdate('1.0.0', async () => release('bad'))).state, 'invalid')
  assert.equal((await checkManualUpdate('1.0.0', async () => release('v1.1.0', { html_url: 'https://evil.example/update' }))).state, 'invalid')
  assert.equal((await checkManualUpdate('1.0.0', async () => new Response('{}', { status: 404 }))).state, 'unconfigured')
  assert.equal((await checkManualUpdate('1.0.0', async () => { throw new TypeError('network failed') })).state, 'offline')
})
