#!/usr/bin/env node
/** Vhostra's local CLI. It imports the compiled store/runtime controller so every
 * Docker operation remains scoped to the same labeled Vhostra project as the UI. */
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const platformDataRoot = () => process.env.VHOSTRA_USER_DATA || (process.platform === 'darwin'
  ? path.join(os.homedir(), 'Library', 'Application Support', 'vhostra')
  : process.platform === 'win32'
    ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'vhostra')
    : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'vhostra'))
const usage = `Vhostra CLI (local-only)

Usage:
  vhostra status | runtime <status|start|stop|restart>
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
All runtime commands target only Vhostra's generated Compose project.`

let activeRuntime
try {
  const { HostsFileManager } = await import('../dist-electron/hosts.js')
  const { readNativeConfiguration } = await import('../dist-electron/config-import.js')
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
  if (subject === 'help' || subject === '--help' || subject === '-h') print(usage)
  else if (subject === 'php' && (!action || action === 'status' || action === 'versions')) {
    const state = await store.getState(); await runtime.refresh()
    print({ implementation: 'LSPHP', selected: state.settings.selectedPhpVersion, supported: supportedPhpVersions, runtime: runtime.current() })
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
  else if (subject === 'status' || (subject === 'runtime' && (!action || action === 'status'))) { await runtime.refresh(); print({ runtime: runtime.current(), services: await runtime.listManagedServices() }) }
  else if (subject === 'runtime' && ['start', 'stop', 'restart'].includes(action)) { await runtime[action](); print(runtime.current()) }
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
