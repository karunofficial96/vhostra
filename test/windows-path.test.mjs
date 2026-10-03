import assert from 'node:assert/strict'
import { test } from 'node:test'
import { changeWindowsUserPath } from '../dist-electron/windows-path.js'

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
