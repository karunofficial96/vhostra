// Sequential, opt-in real Docker acceptance; no protected Hosts file writes.
import assert from 'node:assert/strict'
import { mkdtemp, chmod, writeFile, readFile, rm, stat, realpath } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { execFileSync, spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { VhostraStore } from '../dist-electron/store.js'
import { DockerRuntimeController } from '../dist-electron/runtime.js'
import { HostsFileManager } from '../dist-electron/hosts.js'
import { updateManagedSite } from '../dist-electron/site-workflow.js'
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const request = (port, hostname, url = '/') => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path: url, headers: { Host: hostname } }, response => { let text = ''; response.on('data', data => text += data); response.on('end', () => resolve({ status: response.statusCode, text })) }).on('error', reject)
})
const inventory = () => execFileSync('docker', ['ps', '-a', '--format', '{{.ID}}'], { encoding: 'utf8' }).trim().split('\n').sort()
const originalInventory = inventory()
for (const keep of [true, false]) {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'vhostra-host-live-')); const source = await mkdtemp(path.join(os.tmpdir(), 'vhostra-host-backup-')); const project = await mkdtemp(path.join(os.tmpdir(), 'vhostra-host-project-'))
  const scope = `vhostra-host-live-${process.pid}-${keep ? 'keep' : 'remove'}`; const hostname = `storage-${process.pid}.test`
  const store = new VhostraStore(profile, path.resolve('dist-welcome')); const runtime = new DockerRuntimeController(store.layout, () => store.getState(), message => store.updateLocalhostWelcome(message), scope)
  let complete = false; let last = ''; runtime.subscribe(() => { if (runtime.current().message !== last) { last = runtime.current().message; console.log(last) } })
  try {
    await chmod(project, 0o755); await writeFile(path.join(project, 'index.php'), '<?php if (isset($_GET["log_error"])) trigger_error("Vhostra site error sentinel", E_USER_WARNING); echo "host-root:" . file_get_contents(__DIR__ . "/sentinel");'); await writeFile(path.join(project, 'sentinel'), 'before')
    const backupStore = new VhostraStore(source); const state = await backupStore.addSite({ name: 'Host persistence probe', documentRoot: project, url: `http://${hostname}:31580`, aliases: [`www.${hostname}`] })
    await backupStore.saveSettings({ ...state.settings, selectedWebServer: keep ? 'openlitespeed' : 'nginx', selectedPhpVersion: '8.3', ports: { http: 31580, https: 31543, phpMyAdmin: 31581, mariadb: 31506, redis: 31579, memcached: 31511 } }); await backupStore.saveOnboarding({ ...(await backupStore.getOnboarding()), theme: 'dark' })
    const backup = path.join(source, 'backup.json'); await backupStore.exportBundle(backup); const preview = await store.previewBundle(backup); const restored = await store.restoreOnboardingBundle(backup, preview.checksum)
    assert.deepEqual(restored.missing, []); assert.equal(restored.imported.length, 1); assert.equal((await store.getState()).settings.selectedPhpVersion, '8.3')
    assert.equal((await store.getOnboarding()).theme, 'dark')
    const tempHosts = path.join(profile, 'hosts'); await writeFile(tempHosts, '127.0.0.1 localhost\n# unrelated\n')
    const hosts = new HostsFileManager(path.join(profile, 'hosts-tmp')); Object.defineProperty(hosts, 'hostsPath', { value: tempHosts }); hosts.platform = 'linux'; hosts.execute = async (_command, args) => promisify(execFile)('/bin/sh', args.slice(1))
    await hosts.ensureLocalhostMappings([hostname, `www.${hostname}`]); await runtime.start()
    const saved = await store.getState(); const site = saved.sites.find(site => !site.builtIn); const host = saved.virtualHosts.find(host => !host.builtIn)
    const inspected = JSON.parse(execFileSync('docker', ['inspect', `${scope}-runtime-1`], { encoding: 'utf8' }))[0]
    const mount = inspected.Mounts.find(mount => mount.Destination === host.runtimeDocumentRoot); assert.ok(mount); assert.equal(await realpath(mount.Source), await realpath(project)); assert.equal(mount.RW, true)
    assert.equal((await request(31580, hostname)).text, 'host-root:before')
    await writeFile(path.join(project, 'sentinel'), 'after'); assert.equal((await request(31580, hostname)).text, 'host-root:after', 'Host edits must be served without copying or redeploying')
    await request(31580, hostname, '/?log_error=1')
    for (let attempt = 0; attempt < 20; attempt++) { if ((await readFile(host.logs.paths.access, 'utf8')).includes('GET') && (await readFile(host.logs.paths.error, 'utf8')).includes('Vhostra site error sentinel')) break; await pause(500) }
    assert.match(await readFile(host.logs.paths.access, 'utf8'), /GET/); assert.match(await readFile(host.logs.paths.error, 'utf8'), /Vhostra site error sentinel/)
    assert.equal((await runtime.runtimeStatuses()).find(row => row.id === 'php').state, 'running')
    await runtime.createDatabase({ name: 'host_reset_probe', charset: 'utf8mb4', username: 'host_reset_user', password: 'isolated-host-reset-password' })
    // Shared live edit: canonical + syntax/candidate promotion + TEMP Hosts mutation.
    const newHostname = `renamed-${process.pid}.test`
    await updateManagedSite(store, hosts, runtime, { id: site.id, name: site.name, documentRoot: project, url: `http://${newHostname}:31580`, aliases: [`www.${newHostname}`] })
    assert.equal((await request(31580, newHostname)).text, 'host-root:after'); const mapped = await readFile(tempHosts, 'utf8'); assert.match(mapped, new RegExp(newHostname.replaceAll('.', '\\.'))); assert.doesNotMatch(mapped, new RegExp(hostname.replaceAll('.', '\\.')))
    const environment = { ...process.env, VHOSTRA_USER_DATA: profile, VHOSTRA_RUNTIME_PROJECT: scope }
    const cli = args => JSON.parse(execFileSync(process.execPath, ['scripts/vhostra.mjs', ...args], { encoding: 'utf8', env: environment }))
    assert.equal(cli(['status', 'php']).state, 'running'); assert.equal(cli(['status', 'mariadb']).state, 'running'); assert.equal(cli(['status', 'redis']).state, 'disabled'); assert.equal(cli(['status', keep ? 'nginx' : 'apache']).state, 'inactive')
    assert.equal(cli(['status']).services.length, 6)
    cli(['stop', 'mariadb']); assert.equal(cli(['status', 'mariadb']).state, 'stopped'); cli(['start', 'mariadb']); cli(['restart', 'mariadb'])
    cli(['stop']); assert.equal(cli(['status']).runtime.state, 'stopped'); cli(['start']); cli(['restart']); await runtime.refresh(); assert.ok((await runtime.listDatabases()).includes('host_reset_probe'))
    // Container writable layer is disposable. Reconstruct from the same host state.
    await runtime.compose(['rm', '--force', '--stop', 'runtime']); await runtime.start(); assert.ok((await runtime.listDatabases()).includes('host_reset_probe')); assert.equal((await request(31580, newHostname)).text, 'host-root:after')
    const logBeforeReset = await readFile(host.logs.paths.access, 'utf8'); assert.ok(logBeforeReset.length)
    if (keep) {
      // Real interactive CLI reset in a PTY: no actual protected Hosts mutation
      // because configurations are kept. Every resource remains test-scoped.
      const output = execFileSync('python3', ['test/cli-reset-pty.py', process.execPath, 'scripts/vhostra.mjs', 'reset'], { env: environment, encoding: 'utf8', timeout: 130000 })
      assert.match(output, /Databases removed; Site configurations kept/)
    } else { await store.assertResetSafe(); await hosts.removeVhostraMappings([newHostname, `www.${newHostname}`]); await runtime.resetRuntime(); await runtime.pauseBackgroundWork(); await store.resetConfiguration(false) }
    const reopened = new VhostraStore(profile); assert.equal((await reopened.getOnboarding()).completed, false); assert.equal((await reopened.getState()).sites.length, keep ? 2 : 1)
    await assert.rejects(stat(path.join(store.layout.persistentData.mariaDb, 'host_reset_probe')), /ENOENT/); assert.match(await readFile(path.join(project, 'index.php'), 'utf8'), /host-root/); assert.equal(await readFile(path.join(project, 'sentinel'), 'utf8'), 'after')
    assert.equal(await readFile(host.logs.paths.access, 'utf8'), logBeforeReset, 'Reset preserves diagnostic logs')
    console.log(`LIVE ${keep ? 'KEEP / CLI reset' : 'REMOVE reset'}: backup settings/theme, actual bind-mounted host edits, per-site access/PHP errors, shared hostname/alias transaction, all/specific CLI controls, disposable-container DB persistence, database reset and external-file preservation passed.`)
    complete = true
  } finally {
    if (!complete) { const logs = await runtime.compose(['logs', '--no-color', '--tail', '100', 'runtime']).catch(error => String(error)); await writeFile(path.join(profile, 'failure-container.log'), logs); console.error(logs) }
    await runtime.resetRuntime().catch(error => console.error('Scoped cleanup:', error.message)); await runtime.pauseBackgroundWork(); runtime.dispose()
    if (complete) for (const directory of [profile, source, project]) await rm(directory, { recursive: true, force: true }); else console.error(`Failure diagnostics retained at ${profile}; project ${project}`)
  }
}
assert.deepEqual(inventory(), originalInventory, 'Unrelated Docker inventory must remain unchanged')
