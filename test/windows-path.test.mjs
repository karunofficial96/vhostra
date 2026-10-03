import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { changeWindowsUserPath } from '../dist-electron/windows-path.js'

test('Windows installer exposes its installed root and includes the packaged CLI', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'))
  assert.deepEqual(packageJson.build.win.extraFiles, [{ from: 'packaging/windows/vhostra.cmd', to: 'vhostra.cmd' }])
  const launcher = await readFile('packaging/windows/vhostra.cmd', 'utf8')
  assert.match(launcher, /%~dp0Vhostra\.exe/)
  const installer = await readFile('packaging/windows/installer.nsh', 'utf8')
  assert.match(installer, /!macro customInstall[\s\S]*?WriteRegStr SHELL_CONTEXT "\$\{UNINSTALL_REGISTRY_KEY\}" "InstallLocation" "\$INSTDIR"/)
  assert.match(installer, /\$INSTDIR\\vhostra\.cmd/)
})

test('Windows user PATH install and upgrade add one entry; uninstall removes only owned entry', () => {
  const values = new Map()
  const registry = {
    read: (key, name) => values.get(`${key}/${name}`) ?? null,
    write: (key, name, value) => values.set(`${key}/${name}`, value),
    remove: (key, name) => values.delete(`${key}/${name}`),
  }
  const environment = 'HKCU\\Environment/Path'
  const directory = 'C:\\Users\\Sample\\AppData\\Local\\Programs\\Vhostra'
  values.set(environment, { data: '%USERPROFILE%\\bin;C:\\Program Files\\Git\\cmd', type: 'REG_EXPAND_SZ' })
  assert.equal(changeWindowsUserPath('install', directory, registry), 'changed')
  assert.equal(changeWindowsUserPath('install', directory, registry), 'unchanged')
  assert.equal(values.get(environment).data.split(';').length, 3)
  assert.equal(changeWindowsUserPath('uninstall', directory, registry), 'changed')
  assert.deepEqual(values.get(environment), { data: '%USERPROFILE%\\bin;C:\\Program Files\\Git\\cmd', type: 'REG_EXPAND_SZ' })
  values.set(environment, { data: `${directory};C:\\Docker`, type: 'REG_SZ' })
  assert.equal(changeWindowsUserPath('install', directory, registry), 'unchanged')
  assert.equal(changeWindowsUserPath('uninstall', directory, registry), 'unchanged')
  assert.equal(values.get(environment).data, `${directory};C:\\Docker`)
})

test('Windows PATH round trip preserves existing empty components and their order', () => {
  const values = new Map()
  const registry = {
    read: (key, name) => values.get(`${key}/${name}`) ?? null,
    write: (key, name, value) => values.set(`${key}/${name}`, value),
    remove: (key, name) => values.delete(`${key}/${name}`),
  }
  const key = 'HKCU\\Environment/Path'
  const original = 'C:\\Tools;;%USERPROFILE%\\bin;'
  const directory = 'C:\\Users\\Sample\\AppData\\Local\\Programs\\Vhostra'
  values.set(key, { data: original, type: 'REG_EXPAND_SZ' })
  assert.equal(changeWindowsUserPath('install', directory, registry), 'changed')
  assert.equal(changeWindowsUserPath('install', directory, registry), 'unchanged')
  assert.equal(values.get(key).data, `${original};${directory}`)
  assert.equal(changeWindowsUserPath('uninstall', directory, registry), 'changed')
  assert.deepEqual(values.get(key), { data: original, type: 'REG_EXPAND_SZ' })
})
