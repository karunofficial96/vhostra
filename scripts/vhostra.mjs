#!/usr/bin/env node
/** Vhostra's local CLI. It imports the compiled store/runtime controller so every
 * Docker operation remains scoped to the same labeled Vhostra project as the UI. */
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { promises as fs } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'

const platformDataRoot = () => process.env.VHOSTRA_USER_DATA || (process.platform === 'darwin'
  ? path.join(os.homedir(), 'Library', 'Application Support', 'vhostra')
  : process.platform === 'win32'
    ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'vhostra')
    : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'vhostra'))
const usage = `Vhostra CLI (local-only)

Usage:
  vhostra status [apache|nginx|openlitespeed|web|php|mariadb|phpmyadmin|redis|memcached]
  vhostra <start|stop|restart> [web|apache|nginx|openlitespeed|mariadb|redis|memcached]
  vhostra runtime <status|start|stop|restart>
  vhostra sites <list|add FILE|edit ID FILE|remove ID|repair [ID]>
  vhostra config <export FILE|preview FILE|import FILE>
  vhostra database create NAME USER [utf8mb4|utf8|latin1]
  vhostra database <list|import NAME FILE|export NAME FILE|repair NAME|delete NAME>
  vhostra reset
  vhostra service <list|web|mariadb|redis|memcached> [status|start|stop|restart|enable|disable]
  vhostra web <status|start|stop|restart>
  vhostra mariadb <status|start|stop|restart>
  vhostra php <status|versions|select VERSION>
  vhostra vhost list
  vhostra hosts <status|repair> [hostname]
  vhostra import <preview|apply> PATH [apache|nginx|openlitespeed|litespeed-enterprise] [--accept-warnings]
  vhostra php extensions list
  vhostra php extension <install|enable|disable|remove> <package>
  vhostra opcache <status|enable|disable>
  vhostra cwebp <status|enable|disable>
  vhostra redis <status|enable|disable|start|stop|restart>
  vhostra memcached <status|enable|disable|start|stop|restart>

Set VHOSTRA_USER_DATA only when using a non-default Electron user-data directory.
Reset is interactive only: explains database preservation or removal, asks Keep/Remove/Cancel, then requires explicit final confirmation. Back up in the graphical app first. No non-interactive destructive reset flags exist.
All runtime commands target only Vhostra's generated Compose project.`

let activeRuntime
try {
  const { HostsFileManager } = await import('../dist-electron/hosts.js')
  const { readNativeConfiguration } = await import('../dist-electron/config-import.js')
  const { updateManagedSite } = await import('../dist-electron/site-workflow.js')
  const { VhostraStore, supportedPhpVersions } = await import('../dist-electron/store.js')
  const { DockerRuntimeController } = await import('../dist-electron/runtime.js')
  // The CLI shares Electron's local-first store. Supplying the bundled welcome
  // template prevents a CLI command from replacing localhost with the minimal
  // fallback template used only when no distribution assets exist.
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
  let hosts
  const store = new VhostraStore(platformDataRoot(), path.join(scriptDirectory, '..', 'dist-welcome'), async names => { const conflicts = (await hosts.mappingStatus(names)).filter(item => item.state === 'conflict'); if (conflicts.length) throw new Error(`Hosts conflicts: ${conflicts.map(item => `${item.hostname}: ${item.address}`).join(', ')}`) })
  hosts = new HostsFileManager(path.join(store.layout.root, 'temporary'), path.join(store.layout.backups, 'hosts'))
  if (process.env.VHOSTRA_RUNTIME_PROJECT && !process.env.VHOSTRA_USER_DATA) throw new Error('A custom runtime project requires an explicit isolated VHOSTRA_USER_DATA directory.')
  const runtime = new DockerRuntimeController(store.layout, () => store.getState(), message => store.updateLocalhostWelcome(message), process.env.VHOSTRA_RUNTIME_PROJECT || 'vhostra')
  activeRuntime = runtime
  const [subject = 'status', action] = process.argv.slice(2)
  const print = value => process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`)
  const save = async mutate => { await runtime.refresh(); const current = await store.getState(); await store.saveSettings(mutate(current.settings)); try { await runtime.applyConfiguration(); print(await runtime.refresh()) } catch (error) { await store.saveSettings(current.settings); throw error } }
  const confirm = async question => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Interactive confirmation requires a terminal. Open Vhostra to complete this operation; no non-interactive destructive flags are supported.')
    const prompt = createInterface({ input: process.stdin, output: process.stdout }); try { return (await prompt.question(question)).trim() } finally { prompt.close() }
  }
  const selectedTarget = async target => {
    const selected = (await store.getState()).settings.selectedWebServer
    if (['apache', 'nginx', 'openlitespeed'].includes(target)) { if (target !== selected) throw new Error(`${target} is inactive; selected frontend is ${selected}. Change the selection in Vhostra Settings.`); return 'web' }
    if (!['web', 'mariadb', 'redis', 'memcached'].includes(target)) throw new Error('Choose web, selected Apache/Nginx/OpenLiteSpeed, MariaDB, Redis or Memcached. PHP and phpMyAdmin share the selected web service lifecycle.')
    return target
  }
  if (subject === 'reset') {
    if (process.argv.length !== 3) throw new Error('Reset accepts no destructive flags. Use the interactive workflow.')
    print('Back up databases, Site definitions and important configuration using the Vhostra graphical application first. Keep preserves MariaDB databases/users/roles/grants and credentials. Remove resets Vhostra database state after final confirmation. External site root files remain untouched.')
    const choice = (await confirm('Keep Site/vhost configurations, Remove configurations, or Cancel? [keep/remove/cancel]: ')).toLowerCase()
    if (!['keep', 'remove'].includes(choice)) print('Reset cancelled. State unchanged.')
    else {
      print(`Settings and runtime reset; databases ${choice === 'keep' ? 'preserved' : 'removed'}; Site configurations ${choice === 'keep' ? 'kept' : 'removed'}. External website files remain untouched.`)
      if ((await confirm('Are you sure you want to reset? Type "Yes, Reset Vhostra" to confirm: ')) !== 'Yes, Reset Vhostra') print('Reset cancelled. State unchanged.')
      else {
        const previous = (await store.getState()).settings
        if (previous.startup.launchAtLogin) throw new Error('Open Vhostra Settings → Reset Vhostra to unregister the native login integration and complete reset.')
        await store.assertResetSafe()
        if (choice === 'remove') await hosts.removeVhostraMappings((await store.getState()).virtualHosts.filter(host => !host.builtIn).flatMap(host => [host.hostname, ...host.aliases]))
        await runtime.resetRuntime(choice === 'keep'); await runtime.pauseBackgroundWork(); print(await store.resetConfiguration(choice === 'keep'))
      }
    }
  } else if (['start', 'stop', 'restart'].includes(subject)) {
    if (action) { await runtime.refresh(); print(await runtime.controlManagedService(await selectedTarget(action), subject)) }
    else { await (subject === 'restart' ? runtime.restartAll() : runtime[subject]()); print(runtime.current()) }
  } else if (subject === 'status' && action) {
    const selected = (await store.getState()).settings.selectedWebServer
    if (['apache', 'nginx', 'openlitespeed'].includes(action) && action !== selected) print({ id: action, state: 'inactive', selected })
    else { const rows = await runtime.runtimeStatuses(); const row = rows.find(row => row.id === (action === selected ? 'web' : action)); if (!row) throw new Error('Unknown runtime status target.'); print(row); if (['failed', 'unhealthy', 'unavailable'].includes(row.state)) process.exitCode = 2 }
  } else if (subject === 'sites' && action === 'list') print((await store.getState()).sites)
  else if (subject === 'sites' && ['add', 'edit'].includes(action)) {
    const source = action === 'add' ? process.argv[4] : process.argv[5]; if (!source) throw new Error('Provide a JSON file with name, url, documentRoot, optional aliases/framework.')
    if ((await fs.stat(source)).size > 64 * 1024) throw new Error('Site input exceeds 64 KiB.')
    const input = JSON.parse(await fs.readFile(source, 'utf8')); if (!(await fs.stat(input.documentRoot)).isDirectory()) throw new Error('Choose an existing host document root.')
    await runtime.refresh()
    if (action === 'edit') { print(await updateManagedSite(store, hosts, runtime, { ...input, id: process.argv[4] })); }
    else { const state = await store.addSite(input)
    const host = state.virtualHosts.find(host => host.hostname === new URL(input.url).hostname)
    const mapping = await hosts.ensureLocalhostMappings([host.hostname, ...host.aliases]).catch(error => ({ message: String(error), failed: true }))
    await runtime.refresh(); await runtime.applyConfiguration(); print({ sites: state.sites, mapping }); if (mapping.failed || mapping.conflicts?.length) process.exitCode = 2 }
  } else if (subject === 'sites' && action === 'remove' && process.argv[4]) {
    if ((await confirm('Remove this Site configuration? External files stay untouched. Type remove: ')) !== 'remove') print('Cancelled.')
    else { await store.removeSite(process.argv[4]); const state = await store.getState(); await hosts.reconcileMappings(state.virtualHosts.filter(host => !host.builtIn).flatMap(host => [host.hostname, ...host.aliases])); await runtime.refresh(); await runtime.applyConfiguration(); print('Site configuration removed. External files untouched.') }
  } else if (subject === 'sites' && action === 'repair') {
    const state = await store.getState(); const id = process.argv[4]; const site = id ? state.sites.find(site => site.id === id) : null
    if (id && !site) throw new Error('Site not found.')
    const names = state.virtualHosts.filter(host => !host.builtIn && (!site || host.id === site.vhostId)).flatMap(host => [host.hostname, ...host.aliases])
    print(id ? await hosts.ensureLocalhostMappings(names) : await hosts.reconcileMappings(names)); await runtime.refresh(); await runtime.applyConfiguration()
  } else if (subject === 'config' && ['export', 'preview', 'import'].includes(action) && process.argv[4]) {
    const source = path.resolve(process.argv[4]); print(action === 'export' ? await store.exportBundle(source) : action === 'preview' ? await store.previewBundle(source) : await store.importBundle(source))
    if (action === 'import') { const state = await store.getState(); print(await hosts.reconcileMappings(state.virtualHosts.filter(host => !host.builtIn).flatMap(host => [host.hostname, ...host.aliases]))); await runtime.refresh(); await runtime.applyConfiguration() }
  } else if (subject === 'database' && action === 'list') { await runtime.refresh(); print(await runtime.listDatabases()) }
  else if (subject === 'database' && action === 'create' && process.argv[4] && process.argv[5]) {
    if (!process.stdin.isTTY || !process.stdin.setRawMode) throw new Error('Database creation requires an interactive terminal for the password. Use the graphical Database area otherwise.')
    process.stdout.write('Database password (hidden, at least 12 characters): ')
    const password = await new Promise((resolve, reject) => {
      let value = ''; const restore = () => { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.removeListener('data', onData); process.stdout.write('\n') }
      const onData = data => { for (const character of data.toString()) { if (character === '\u0003') { restore(); reject(new Error('Cancelled.')); return } if (character === '\r' || character === '\n') { restore(); resolve(value); return } if (character === '\u007f' || character === '\b') value = value.slice(0, -1); else if (value.length < 1024 && character >= ' ') value += character } }
      process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.on('data', onData)
    })
    await runtime.refresh(); print(await runtime.createDatabase({ name: process.argv[4], username: process.argv[5], charset: process.argv[6] || 'utf8mb4', password }))
  } else if (subject === 'database' && ['import', 'export', 'repair', 'delete'].includes(action) && process.argv[4]) {
    const database = process.argv[4]; await runtime.refresh()
    if (action === 'delete' && (await confirm(`Delete database ${database} and all its data? Type delete: `)) !== 'delete') print('Cancelled.')
    else if (action === 'repair') print(await runtime.repairDatabase(database))
    else if (action === 'delete') print(await runtime.deleteDatabase(database))
    else { if (!process.argv[5]) throw new Error('Provide an SQL file path.'); print(await runtime[action === 'import' ? 'importDatabase' : 'exportDatabase'](database, path.resolve(process.argv[5]))) }
  } else if (subject === 'help' || subject === '--help' || subject === '-h') print(usage)
  else if (subject === 'php' && (!action || action === 'status' || action === 'versions')) {
    const state = await store.getState(); await runtime.refresh()
    print({ implementation: 'LSPHP', selected: state.settings.selectedPhpVersion, supported: supportedPhpVersions, runtime: runtime.current(), ...(action !== 'versions' ? { service: (await runtime.runtimeStatuses()).find(row => row.id === 'php') } : {}) })
  } else if (subject === 'php' && action === 'select' && process.argv[4]) {
    if (!supportedPhpVersions.includes(process.argv[4])) throw new Error(`Supported PHP versions: ${supportedPhpVersions.join(', ')}`)
    await save(settings => ({ ...settings, selectedPhpVersion: process.argv[4] }))
  } else if (subject === 'vhost' && action === 'list') print((await store.getState()).virtualHosts)
  else if (subject === 'hosts' && ['status', 'repair'].includes(action)) {
    const state = await store.getState(); const all = state.virtualHosts.filter(host => !host.builtIn).flatMap(host => [host.hostname, ...host.aliases])
    const name = process.argv[4]; if (name && !all.includes(name)) throw new Error('That hostname is not owned by a Vhostra canonical virtual host.')
    const result = action === 'status' ? await hosts.mappingStatus(name ? [name] : all) : name ? await hosts.ensureLocalhostMappings([name]) : await hosts.reconcileMappings(all)
    print(result); if (action === 'status' ? result.some(item => item.state !== 'mapped') : result.conflicts.length) process.exitCode = 2
  } else if (subject === 'import' && ['preview', 'apply'].includes(action) && process.argv[4]) {
    const hint = process.argv[5]?.startsWith('--') ? undefined : process.argv[5]
    const preview = await readNativeConfiguration(path.resolve(process.argv[4]), hint)
    if (action === 'preview') { const { sourceText, ...report } = preview; print(report); if (preview.status === 'Invalid') process.exitCode = 2 }
    else {
      if (preview.status === 'Invalid') throw new Error(preview.warnings.join(' '))
      if (preview.status === 'Requires review' && !process.argv.includes('--accept-warnings')) throw new Error('Review the import preview, then pass --accept-warnings to import supported settings while preserving inactive source directives.')
      const result = await store.importNative(preview)
      const mapping = await hosts.ensureLocalhostMappings(preview.hosts.flatMap(host => [host.hostname, ...host.aliases])).catch(error => ({ message: String(error), conflicts: [], failed: true }))
      await runtime.refresh(); await runtime.applyConfiguration(); print({ ...result, mapping }); if (mapping.conflicts.length || mapping.failed) process.exitCode = 2
    }
  } else if (['web', 'mariadb'].includes(subject) && ['status', 'start', 'stop', 'restart'].includes(action)) {
    await runtime.refresh(); print(action === 'status' ? (await runtime.listManagedServices()).find(service => service.id === subject) : await runtime.controlManagedService(subject, action))
  }
  else if (subject === 'status' || (subject === 'runtime' && (!action || action === 'status'))) { await runtime.refresh(); const rows = await runtime.runtimeStatuses(); print({ runtime: runtime.current(), services: rows }); if (['unavailable', 'error'].includes(runtime.current().state) || rows.some(row => row.enabled && ['failed','unhealthy','unavailable'].includes(row.state))) process.exitCode = 2 }
  else if (subject === 'runtime' && ['start', 'stop', 'restart'].includes(action)) { await (action === 'restart' ? runtime.restartAll() : runtime[action]()); print(runtime.current()) }
  else if (subject === 'service' && (action === 'list' || !action)) { await runtime.refresh(); print(await runtime.listManagedServices()) }
  else if (subject === 'service' && ['web', 'mariadb', 'redis', 'memcached'].includes(action) && ['status', 'start', 'stop', 'restart'].includes(process.argv[4])) {
    await runtime.refresh(); print(process.argv[4] === 'status' ? (await runtime.listManagedServices()).find(service => service.id === action) : await runtime.controlManagedService(action, process.argv[4]))
  } else if (subject === 'service' && ['redis', 'memcached'].includes(action) && ['enable', 'disable'].includes(process.argv[4])) {
    await save(settings => ({ ...settings, optionalServices: { ...settings.optionalServices, [action]: process.argv[4] === 'enable' } }))
  }
  else if (subject === 'php' && action === 'extensions' && process.argv[4] === 'list') { await runtime.refresh(); print(await runtime.listPhpExtensions()) }
  else if (subject === 'php' && action === 'extension' && ['install', 'enable', 'disable', 'remove'].includes(process.argv[4]) && process.argv[5]) {
    await runtime.refresh(); const operation = process.argv[4]; const extension = process.argv[5]
    print(await runtime.managePhpExtension(extension, operation))
    const current = await store.getState(); const enabled = operation === 'install' || operation === 'enable'
    await store.saveSettings({ ...current.settings, php: { ...current.settings.php, extensions: enabled ? [...new Set([...current.settings.php.extensions, extension])] : current.settings.php.extensions.filter(value => value !== extension), disabledExtensions: operation === 'disable' ? [...new Set([...current.settings.php.disabledExtensions, extension])] : current.settings.php.disabledExtensions.filter(value => value !== extension) } })
  } else if (subject === 'opcache' && ['status', 'enable', 'disable'].includes(action)) {
    if (action === 'status') { await runtime.refresh(); print((await runtime.listPhpExtensions()).find(extension => extension.id === 'opcache') ?? { status: 'unavailable' }) }
    else await save(settings => ({ ...settings, php: { ...settings.php, opcacheEnabled: action === 'enable' } }))
  } else if (subject === 'cwebp' && ['status', 'enable', 'disable'].includes(action)) {
    if (action === 'status') { await runtime.refresh(); print(await runtime.getCwebpStatus()) }
    else { await runtime.refresh(); print(await runtime.configureCwebp(action === 'enable')); const current = await store.getState(); await store.saveSettings({ ...current.settings, php: { ...current.settings.php, cwebpEnabled: action === 'enable' } }) }
  } else if (['redis', 'memcached'].includes(subject) && ['status', 'enable', 'disable', 'start', 'stop', 'restart'].includes(action)) {
    if (action === 'status') { await runtime.refresh(); const state = await store.getState(); print({ enabled: state.settings.optionalServices[subject], service: (await runtime.listManagedServices()).find(service => service.id === subject), runtime: runtime.current() }) }
    else if (['start', 'stop', 'restart'].includes(action)) { await runtime.refresh(); print(await runtime.controlManagedService(subject, action)) }
    else await save(settings => ({ ...settings, optionalServices: { ...settings.optionalServices, [subject]: action === 'enable' } }))
  } else { process.stderr.write(`${usage}\n`); process.exitCode = 64 }
} catch (error) { process.stderr.write(`Vhostra: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1 }

finally { activeRuntime?.dispose() }
