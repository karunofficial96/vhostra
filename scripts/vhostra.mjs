#!/usr/bin/env node
/** Vhostra's local CLI. It imports the compiled store/runtime controller so every
 * Docker operation remains scoped to the same labeled Vhostra project as the UI. */
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const platformDataRoot = () => process.env.VHOSTRA_USER_DATA || (process.platform === 'darwin'
  ? path.join(os.homedir(), 'Library', 'Application Support', 'Vhostra')
  : process.platform === 'win32'
    ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Vhostra')
    : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'Vhostra'))
const usage = `Vhostra CLI (local-only)

Usage:
  vhostra status | runtime <status|start|stop|restart>
  vhostra service <list|web|mariadb|redis|memcached> [start|stop|restart|enable|disable]
  vhostra php extensions list
  vhostra php extension <install|enable|disable|remove> <package>
  vhostra opcache <status|enable|disable>
  vhostra cwebp <status|enable|disable>
  vhostra redis <status|enable|disable|restart>
  vhostra memcached <status|enable|disable|restart>

Set VHOSTRA_USER_DATA only when using a non-default Electron user-data directory.
All runtime commands target only Vhostra's generated Compose project.`

try {
  const { VhostraStore } = await import('../dist-electron/store.js')
  const { DockerRuntimeController } = await import('../dist-electron/runtime.js')
  // The CLI shares Electron's local-first store. Supplying the bundled welcome
  // template prevents a CLI command from replacing localhost with the minimal
  // fallback template used only when no distribution assets exist.
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
  const store = new VhostraStore(platformDataRoot(), path.join(scriptDirectory, '..', 'dist-welcome'))
  const runtime = new DockerRuntimeController(store.layout, () => store.getState(), message => store.updateLocalhostWelcome(message))
  const [subject = 'status', action] = process.argv.slice(2)
  const print = value => process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`)
  const save = async mutate => { const current = await store.getState(); await store.saveSettings(mutate(current.settings)); await runtime.applyConfiguration(); print(await runtime.refresh()) }
  if (subject === 'help' || subject === '--help' || subject === '-h') print(usage)
  else if (subject === 'status' || (subject === 'runtime' && (!action || action === 'status'))) { await runtime.refresh(); print({ runtime: runtime.current(), services: await runtime.listManagedServices() }) }
  else if (subject === 'runtime' && ['start', 'stop', 'restart'].includes(action)) { await runtime[action](); print(runtime.current()) }
  else if (subject === 'service' && (action === 'list' || !action)) { await runtime.refresh(); print(await runtime.listManagedServices()) }
  else if (subject === 'service' && ['web', 'mariadb', 'redis', 'memcached'].includes(action) && ['start', 'stop', 'restart'].includes(process.argv[4])) {
    await runtime.refresh(); print(await runtime.controlManagedService(action, process.argv[4]))
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
    if (action === 'status') print((await runtime.listPhpExtensions()).find(extension => extension.id === 'opcache') ?? { status: 'unavailable' })
    else await save(settings => ({ ...settings, php: { ...settings.php, opcacheEnabled: action === 'enable' } }))
  } else if (subject === 'cwebp' && ['status', 'enable', 'disable'].includes(action)) {
    if (action === 'status') { await runtime.refresh(); print(await runtime.getCwebpStatus()) }
    else { await runtime.refresh(); print(await runtime.configureCwebp(action === 'enable')); const current = await store.getState(); await store.saveSettings({ ...current.settings, php: { ...current.settings.php, cwebpEnabled: action === 'enable' } }) }
  } else if (['redis', 'memcached'].includes(subject) && ['status', 'enable', 'disable', 'restart'].includes(action)) {
    if (action === 'status') { await runtime.refresh(); const state = await store.getState(); print({ enabled: state.settings.optionalServices[subject], runtime: runtime.current() }) }
    else if (action === 'restart') { await runtime.refresh(); print(await runtime.controlManagedService(subject, 'restart')) }
    else await save(settings => ({ ...settings, optionalServices: { ...settings.optionalServices, [subject]: action === 'enable' } }))
  } else { process.stderr.write(`${usage}\n`); process.exitCode = 64 }
} catch (error) { process.stderr.write(`Vhostra: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1 }
