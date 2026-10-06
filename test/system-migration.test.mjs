import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { inspectLegacySystemStorage } from '../dist-electron/system-migration.js'

test('system migration inventory includes owned state and leaves website, backup and preview content out', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'vhostra-system-inventory-'))
  const root = path.join(parent, 'Vhostra')
  const website = path.join(parent, 'website')
  try {
    for (const directory of ['sites', 'runtime', 'data/mariadb', 'certificates/private', 'backups', 'exports', 'cache/screenshots', 'logs', website]) {
      await mkdir(path.isAbsolute(directory) ? directory : path.join(root, directory), { recursive: true })
    }
    await writeFile(path.join(root, 'settings.json'), '{}')
    await writeFile(path.join(root, 'sites', 'site.json'), '{}')
    await writeFile(path.join(root, 'data/mariadb', 'identity'), 'database')
    await writeFile(path.join(root, 'certificates/private', 'localhost.key'), 'private')
    await writeFile(path.join(root, 'backups', 'backup.json'), 'backup')
    await writeFile(path.join(root, 'exports', 'export.json'), 'export')
    await writeFile(path.join(root, 'cache/screenshots', 'site.jpg'), 'site content')
    await writeFile(path.join(root, 'logs', 'runtime.log'), 'log')
    await writeFile(path.join(website, 'index.php'), 'website')
    const inventory = await inspectLegacySystemStorage(root, [website])
    assert.deepEqual(inventory.map(item => item.relativePath), [
      'certificates/private/localhost.key', 'data/mariadb/identity', 'logs/runtime.log', 'settings.json', 'sites/site.json',
    ])
    assert.equal(await readFile(path.join(website, 'index.php'), 'utf8'), 'website')
  } finally { await rm(parent, { recursive: true, force: true }) }
})

test('system migration inventory rejects managed links and overlapping website roots', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'vhostra-system-inventory-'))
  const root = path.join(parent, 'Vhostra')
  try {
    await mkdir(path.join(root, 'data', 'mariadb'), { recursive: true })
    await mkdir(path.join(root, 'sites', 'project'), { recursive: true })
    await assert.rejects(inspectLegacySystemStorage(root, [path.join(root, 'sites', 'project')]), /overlaps/)
    await symlink(path.join(parent, 'outside'), path.join(root, 'data', 'mariadb', 'linked'))
    await assert.rejects(inspectLegacySystemStorage(root), /symbolic link/)
  } finally { await rm(parent, { recursive: true, force: true }) }
})
