#!/usr/bin/env node
/** Vhostra's local CLI. It imports the compiled store/runtime controller so every
 * Docker operation remains scoped to the same labeled Vhostra project as the UI. */
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { promises as fs } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { formatCliError, formatResult, formatStatus, prerequisiteMessage } from './cli-format.mjs'

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
  vhostra database users
  vhostra database user <delete|password> USER HOST
  vhostra database access grant DATABASE USER HOST
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

const args = process.argv.slice(2)
const [command = 'status', subcommand] = args
if (args.includes('--help') || args.includes('-h') || command === 'help') {
  const target = command === 'help' ? subcommand : command
  const examples = {
    runtime: 'Check or start the full local environment. Example: vhostra runtime status',
    service: 'Inspect or control one managed service. Example: vhostra service mariadb status',
    database: 'Manage local MariaDB databases. Example: vhostra database list',
    sites: 'Manage local Site definitions. Example: vhostra sites list',
    config: 'Export, preview or import a local configuration bundle.',
    php: 'Inspect PHP or change the selected version and optional extensions.',
    hosts: 'Inspect or repair Vhostra-owned local Hosts mappings.',
    import: 'Preview or apply a supported local server configuration file.',
    reset: 'Interactive protected reset. Back up first.',
  }
  process.stdout.write(`${target && examples[target] ? `${examples[target]}\n\n` : ''}${usage}\n`)
  process.exit(0)
}
const exact = (words, min, max = min) => args.length >= min && args.length <= max && words.includes(subcommand)
const valid = (() => {
  switch (command) {
    case 'status': return args.length <= 2 && (!subcommand || ['apache','nginx','openlitespeed','web','php','mariadb','phpmyadmin','redis','memcached'].includes(subcommand))
    case 'start': case 'stop': case 'restart': return args.length <= 2 && (!subcommand || ['web','apache','nginx','openlitespeed','mariadb','redis','memcached'].includes(subcommand))
    case 'runtime': return exact(['status','start','stop','restart'], 2) || args.length === 1
    case 'service': return args.length === 1 || args.length === 2 && subcommand === 'list' || args.length === 3 && ['web','mariadb','redis','memcached'].includes(subcommand) && ['status','start','stop','restart', ...(['redis','memcached'].includes(subcommand) ? ['enable','disable'] : [])].includes(args[2])
    case 'web': case 'mariadb': return exact(['status','start','stop','restart'], 2)
    case 'redis': case 'memcached': return exact(['status','enable','disable','start','stop','restart'], 2)
    case 'opcache': case 'cwebp': return exact(['status','enable','disable'], 2)
    case 'sites': return exact(['list'], 2) || exact(['add','remove'], 3) || exact(['edit'], 4) || exact(['repair'], 2, 3)
    case 'config': return exact(['export','preview','import'], 3)
    case 'database': return exact(['list','users'], 2) || exact(['create'], 4, 5) || exact(['import','export'], 4) || exact(['repair','delete'], 3) || args.length === 5 && subcommand === 'user' && ['delete','password'].includes(args[2]) || args.length === 6 && subcommand === 'access' && args[2] === 'grant'
    case 'php': return args.length === 1 || exact(['status','versions'], 2) || exact(['select'], 3) || args.length === 3 && subcommand === 'extensions' && args[2] === 'list' || args.length === 4 && subcommand === 'extension' && ['install','enable','disable','remove'].includes(args[2])
    case 'vhost': return exact(['list'], 2)
    case 'hosts': return exact(['status','repair'], 2, 3)
    case 'import': return args.length >= 3 && args.length <= 5 && ['preview','apply'].includes(subcommand) && (args.length < 4 || ['apache','nginx','openlitespeed','litespeed-enterprise','--accept-warnings'].includes(args[3])) && (args.length < 5 || subcommand === 'apply' && args[4] === '--accept-warnings')
    case 'reset': return args.length === 1
    default: return false
  }
})()
if (!valid) { process.stderr.write(`${usage}\n`); process.exit(64) }

let activeRuntime
try {
  const { HostsFileManager } = await import('../dist-electron/hosts.js')
  const { readNativeConfiguration } = await import('../dist-electron/config-import.js')
  const { updateManagedSite } = await import('../dist-electron/site-workflow.js')
  const { VhostraStore, supportedPhpVersions } = await import('../dist-electron/store.js')
  const { DockerRuntimeController } = await import('../dist-electron/runtime.js')
  const { redactProgress } = await import('../dist-electron/progress.js')
  // The CLI shares Electron's local-first store. Supplying the bundled welcome
  // template prevents a CLI command from replacing localhost with the minimal
  // fallback template used only when no distribution assets exist.
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
  let hosts
  const store = new VhostraStore(platformDataRoot(), path.join(scriptDirectory, '..', 'dist-welcome'), async names => { const conflicts = (await hosts.mappingStatus(names)).filter(item => item.state === 'conflict'); if (conflicts.length) throw new Error(`Hosts conflicts: ${conflicts.map(item => `${item.hostname}: ${item.address}`).join(', ')}`) })
  const testHosts = process.env.VHOSTRA_TEST_HOSTS_PATH
  let fixtureHosts
  if (testHosts) {
    const profile = process.env.VHOSTRA_USER_DATA && path.resolve(process.env.VHOSTRA_USER_DATA)
    const relative = profile && path.relative(os.tmpdir(), profile)
    if (!profile || !relative || relative.startsWith('..') || path.isAbsolute(relative) || !/^vhostra-cli-live-\d+$/.test(process.env.VHOSTRA_RUNTIME_PROJECT ?? '') || path.resolve(testHosts) !== path.join(profile, 'hosts-fixture')) throw new Error('Test Hosts path requires an isolated temporary CLI fixture.')
    fixtureHosts = path.resolve(testHosts)
  }
  hosts = new HostsFileManager(path.join(store.layout.root, 'temporary'), path.join(store.layout.backups, 'hosts'), fixtureHosts)
  if (process.env.VHOSTRA_RUNTIME_PROJECT && !process.env.VHOSTRA_USER_DATA) throw new Error('A custom runtime project requires an explicit isolated VHOSTRA_USER_DATA directory.')
  const runtime = new DockerRuntimeController(store.layout, () => store.getState(), message => store.updateLocalhostWelcome(message), process.env.VHOSTRA_RUNTIME_PROJECT || 'vhostra')
  activeRuntime = runtime
  const [subject = 'status', action] = process.argv.slice(2)
  const print = value => process.stdout.write(`${redactProgress(formatResult(value, process.argv.slice(2, 4).join(' ')))}\n`)
  const requireMariaDb = async () => {
    const service = (await runtime.listManagedServices()).find(row => row.id === 'mariadb')
    if (service?.state === 'running') return
    throw new Error(prerequisiteMessage('MariaDB', service?.state, 'vhostra mariadb start'))
  }
  const phpStatus = async () => { const state = await store.getState(); const row = (await runtime.runtimeStatuses()).find(item => item.id === 'php'); const server = state.settings.selectedWebServer; const integration = server === 'openlitespeed' ? 'LSPHP' : 'PHP-FPM'; return `PHP\nSelected version: ${state.settings.selectedPhpVersion}\nRuntime version: ${row?.state === 'running' ? state.settings.selectedPhpVersion : 'Not running'}\nWeb server: ${server === 'openlitespeed' ? 'OpenLiteSpeed' : server === 'nginx' ? 'Nginx' : 'Apache'}\nIntegration: ${integration}\nStatus: ${row?.state ?? 'Unavailable'}` }
  const save = async mutate => { await runtime.refresh(); const current = await store.getState(); await store.saveSettings(mutate(current.settings)); try { await runtime.applyConfiguration(); print(await runtime.refresh()) } catch (error) { await store.saveSettings(current.settings); throw error } }
  const confirm = async question => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Interactive confirmation requires a terminal. Open Vhostra to complete this operation; no non-interactive destructive flags are supported.')
    const prompt = createInterface({ input: process.stdin, output: process.stdout }); try { return (await prompt.question(question)).trim() } finally { prompt.close() }
  }
  const hiddenPassword = async question => {
    if (!process.stdin.isTTY || !process.stdin.setRawMode) throw new Error('A terminal is required for hidden password entry. Use the graphical Database area otherwise.')
    process.stdout.write(question)
    return new Promise((resolve, reject) => {
      let value = ''
      const restore = () => { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.removeListener('data', onData); process.stdout.write('\n') }
      const onData = data => { for (const character of data.toString()) { if (character === '\u0003') { restore(); reject(new Error('Cancelled.')); return } if (character === '\r' || character === '\n') { restore(); resolve(value); return } if (character === '\u007f' || character === '\b') value = value.slice(0, -1); else if (value.length < 1024 && character >= ' ') value += character } }
      process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.on('data', onData)
    })
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
      print(`Selected: databases ${choice === 'keep' ? 'preserved' : 'removed'}; Site configurations ${choice === 'keep' ? 'kept' : 'removed'}. External website files remain untouched.`)
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
    else if (action === 'php') print(await phpStatus())
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
    else { const before = await store.getState(); const site = before.sites.find(item => item.id === process.argv[4]); const host = before.virtualHosts.find(item => item.id === site?.vhostId); await store.removeSite(process.argv[4]); if (host) await hosts.removeVhostraMappings([host.hostname, ...host.aliases]); await runtime.refresh(); await runtime.applyConfiguration(); print('Site configuration removed. External files untouched.') }
  } else if (subject === 'sites' && action === 'repair') {
    const state = await store.getState(); const id = process.argv[4]; const site = id ? state.sites.find(site => site.id === id) : null
    if (id && !site) throw new Error('Site not found.')
    const names = state.virtualHosts.filter(host => !host.builtIn && (!site || host.id === site.vhostId)).flatMap(host => [host.hostname, ...host.aliases])
    print(names.length ? await hosts.ensureLocalhostMappings(names) : { installed: [], alreadyMapped: [], conflicts: [], message: 'No Site hostnames to repair.' }); await runtime.refresh(); await runtime.applyConfiguration()
  } else if (subject === 'config' && ['export', 'preview', 'import'].includes(action) && process.argv[4]) {
    const source = path.resolve(process.argv[4]); print(action === 'export' ? await store.exportBundle(source) : action === 'preview' ? await store.previewBundle(source) : await store.importBundle(source))
    if (action === 'import') { const state = await store.getState(); const names = state.virtualHosts.filter(host => !host.builtIn).flatMap(host => [host.hostname, ...host.aliases]); print(names.length ? await hosts.ensureLocalhostMappings(names) : { installed: [], alreadyMapped: [], conflicts: [], message: 'No Site hostnames to repair.' }); await runtime.refresh(); await runtime.applyConfiguration() }
  } else if (subject === 'database' && action === 'list') { await runtime.refresh(); await requireMariaDb(); print(await runtime.listDatabases()) }
  else if (subject === 'database' && action === 'users') { await runtime.refresh(); await requireMariaDb(); print(await runtime.listDatabaseUsers()) }
  else if (subject === 'database' && action === 'user' && process.argv[4] === 'delete') {
    await runtime.refresh(); await requireMariaDb()
    const [username, host] = [process.argv[5], process.argv[6]]
    if ((await confirm(`Delete database user ${username}@${host}? Type delete: `)) !== 'delete') print('Cancelled.')
    else print(await runtime.deleteDatabaseUser({ username, host }))
  } else if (subject === 'database' && action === 'user' && process.argv[4] === 'password') {
    await runtime.refresh(); await requireMariaDb()
    const password = await hiddenPassword('New database password (hidden, at least 12 characters): ')
    print(await runtime.changeDatabaseUserPassword({ username: process.argv[5], host: process.argv[6], password }))
  } else if (subject === 'database' && action === 'access' && process.argv[4] === 'grant') {
    await runtime.refresh(); await requireMariaDb()
    const password = await hiddenPassword('Current database password (hidden): ')
    print(await runtime.updateDatabaseAccess({ database: process.argv[5], username: process.argv[6], host: process.argv[7], password }))
  }
  else if (subject === 'database' && action === 'create' && process.argv[4] && process.argv[5]) {
    await runtime.refresh(); await requireMariaDb()
    const password = await hiddenPassword('Database password (hidden, at least 12 characters): ')
    print(await runtime.createDatabase({ name: process.argv[4], username: process.argv[5], charset: process.argv[6] || 'utf8mb4', password }))
  } else if (subject === 'database' && ['import', 'export', 'repair', 'delete'].includes(action) && process.argv[4]) {
    const database = process.argv[4]; await runtime.refresh(); await requireMariaDb()
    if (action === 'delete' && (await confirm(`Delete database ${database} and all its data? Type delete: `)) !== 'delete') print('Cancelled.')
    else if (action === 'repair') print(await runtime.repairDatabase(database))
    else if (action === 'delete') print(await runtime.deleteDatabase(database))
    else { if (!process.argv[5]) throw new Error('Provide an SQL file path.'); print(await runtime[action === 'import' ? 'importDatabase' : 'exportDatabase'](database, path.resolve(process.argv[5]))) }
  } else if (subject === 'help' || subject === '--help' || subject === '-h') print(usage)
  else if (subject === 'php' && (!action || action === 'status' || action === 'versions')) {
    const state = await store.getState(); await runtime.refresh()
    print(action === 'versions' ? { selected: state.settings.selectedPhpVersion, supported: supportedPhpVersions, active: (await runtime.runtimeStatuses()).find(row => row.id === 'php')?.state === 'running' ? state.settings.selectedPhpVersion : undefined } : await phpStatus())
  } else if (subject === 'php' && action === 'select' && process.argv[4]) {
    if (!supportedPhpVersions.includes(process.argv[4])) throw new Error(`Supported PHP versions: ${supportedPhpVersions.join(', ')}`)
    await save(settings => ({ ...settings, selectedPhpVersion: process.argv[4] }))
  } else if (subject === 'vhost' && action === 'list') print((await store.getState()).virtualHosts)
  else if (subject === 'hosts' && ['status', 'repair'].includes(action)) {
    const state = await store.getState(); const all = state.virtualHosts.filter(host => !host.builtIn).flatMap(host => [host.hostname, ...host.aliases])
    const name = process.argv[4]; if (name && !all.includes(name)) throw new Error('That hostname is not owned by a Vhostra canonical virtual host.')
    const result = action === 'status' ? await hosts.mappingStatus(name ? [name] : all) : (name || all.length) ? await hosts.ensureLocalhostMappings(name ? [name] : all) : { installed: [], alreadyMapped: [], conflicts: [], message: 'No Site hostnames to repair.' }
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
  else if (subject === 'status' || (subject === 'runtime' && (!action || action === 'status'))) { await runtime.refresh(); const rows = await runtime.runtimeStatuses(); process.stdout.write(`${formatStatus(runtime.current(), rows)}\n`); if (['unavailable', 'error'].includes(runtime.current().state) || rows.some(row => row.enabled && ['failed','unhealthy','unavailable'].includes(row.state))) process.exitCode = 2 }
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
    const result = await runtime.managePhpExtension(extension, operation)
    const current = await store.getState(); const enabled = operation === 'install' || operation === 'enable'
    await store.saveSettings({ ...current.settings, php: { ...current.settings.php, extensions: enabled ? [...new Set([...current.settings.php.extensions, extension])] : current.settings.php.extensions.filter(value => value !== extension), disabledExtensions: operation === 'disable' ? [...new Set([...current.settings.php.disabledExtensions, extension])] : current.settings.php.disabledExtensions.filter(value => value !== extension) } })
    print(result)
  } else if (subject === 'opcache' && ['status', 'enable', 'disable'].includes(action)) {
    if (action === 'status') { await runtime.refresh(); print((await runtime.listPhpExtensions()).find(extension => extension.id === 'opcache') ?? { status: 'unavailable' }) }
    else await save(settings => ({ ...settings, php: { ...settings.php, opcacheEnabled: action === 'enable' } }))
  } else if (subject === 'cwebp' && ['status', 'enable', 'disable'].includes(action)) {
    if (action === 'status') { await runtime.refresh(); print(await runtime.getCwebpStatus()) }
    else { await runtime.refresh(); const result = await runtime.configureCwebp(action === 'enable'); const current = await store.getState(); await store.saveSettings({ ...current.settings, php: { ...current.settings.php, cwebpEnabled: action === 'enable' } }); print(result) }
  } else if (['redis', 'memcached'].includes(subject) && ['status', 'enable', 'disable', 'start', 'stop', 'restart'].includes(action)) {
    if (action === 'status') { await runtime.refresh(); print((await runtime.runtimeStatuses()).find(service => service.id === subject)) }
    else if (['start', 'stop', 'restart'].includes(action)) { await runtime.refresh(); print(await runtime.controlManagedService(subject, action)) }
    else await save(settings => ({ ...settings, optionalServices: { ...settings.optionalServices, [subject]: action === 'enable' } }))
  } else { process.stderr.write(`${usage}\n`); process.exitCode = 64 }
} catch (error) { const { redactProgress } = await import('../dist-electron/progress.js').catch(() => ({ redactProgress: value => value })); const message = error instanceof Error ? error.message : String(error); const applicationRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); process.stderr.write(`Vhostra: ${formatCliError(redactProgress(message).split(applicationRoot).join('[Vhostra application]'), [command, subcommand].filter(Boolean).join(' '))}\n`); process.exitCode = 1 }

finally { activeRuntime?.dispose() }
