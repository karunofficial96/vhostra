// Opt-in sequential live CLI fixture. Uses only its own temporary profile/project.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { VhostraStore } from '../dist-electron/store.js'
import { DockerRuntimeController } from '../dist-electron/runtime.js'

const profile = await mkdtemp(path.join(os.tmpdir(), 'vhostra-cli-live-'))
const scope = `vhostra-cli-live-${process.pid}`
const store = new VhostraStore(profile)
const runtime = new DockerRuntimeController(store.layout, () => store.getState(), undefined, scope)
const env = { ...process.env, VHOSTRA_USER_DATA: profile, VHOSTRA_RUNTIME_PROJECT: scope }
let interrupted = false
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { interrupted = true })
const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 30000 }).trim()
const inventory = () => Object.fromEntries([scope, `${scope}-database`].flatMap(project => [
  [`${project}:containers`, docker(['ps', '-a', '--filter', `label=com.docker.compose.project=${project}`, '--format', '{{.ID}}'])],
  [`${project}:networks`, docker(['network', 'ls', '--filter', `label=com.docker.compose.project=${project}`, '--format', '{{.ID}}'])],
]))
const before = inventory()
function cli(args, expected = 0, prompt) {
  const command = prompt ? 'python3' : process.execPath
  const parameters = prompt
    ? ['test/cli-prompt-pty.py', process.execPath, 'scripts/vhostra.mjs', ...args]
    : ['scripts/vhostra.mjs', ...args]
  const result = spawnSync(command, parameters, {
    encoding: 'utf8', timeout: 900000,
    env: { ...env, ...(prompt ? { VHOSTRA_TEST_PROMPT: prompt.needle, VHOSTRA_TEST_ANSWER: prompt.answer } : {}) },
  })
  if (interrupted) throw new Error('CLI fixture interrupted; cleaning its exact Docker project.')
  assert.equal(result.status, expected, `${args.join(' ')}: ${result.error?.message ?? ''}\n${result.stdout?.slice(-900)}\n${result.stderr?.slice(-900)}`)
  assert.doesNotMatch(result.stderr, /at .*\.(?:mjs|js):\d+/)
  console.log(`CLI ${expected === 0 ? 'PASS' : 'EXPECTED FAILURE'} ${args.join(' ')}`)
  return `${result.stdout}\n${result.stderr}`
}
try {
  const initial = await store.getState()
  await store.saveSettings({ ...initial.settings, ports: { http: 29580, https: 29543, phpMyAdmin: 29581, mariadb: 29506, redis: 29579, memcached: 29511 } })
  cli(['runtime', 'status'])
  cli(['runtime', 'start'])
  assert.match(cli(['status']), /Running/)
  for (const target of ['openlitespeed', 'apache', 'nginx', 'web', 'php', 'mariadb', 'phpmyadmin', 'redis', 'memcached']) cli(['status', target])
  for (const command of [['service', 'list'], ['php', 'status'], ['php', 'versions'], ['php', 'extensions', 'list'], ['opcache', 'status'], ['cwebp', 'status'], ['sites', 'list'], ['sites', 'repair'], ['vhost', 'list'], ['hosts', 'status'], ['hosts', 'repair'], ['database', 'list']]) cli(command)
  cli(['hosts', 'repair', 'unowned.test'], 1)
  cli(['start', 'apache'], 1)
  cli(['php', 'select', '8.0'], 1)
  cli(['php', 'select', '8.5'])
  const bundle = path.join(profile, 'cli-config.json')
  cli(['config', 'export', bundle])
  cli(['config', 'preview', bundle])
  cli(['config', 'import', bundle])
  cli(['php', 'extension', 'install', 'apcu'])
  assert.match(cli(['php', 'extensions', 'list']), /APCu/i)
  cli(['php', 'extension', 'disable', 'apcu'])
  cli(['php', 'extension', 'enable', 'apcu'])
  cli(['php', 'extension', 'remove', 'apcu'])
  cli(['opcache', 'disable']); cli(['opcache', 'enable'])
  cli(['cwebp', 'disable']); cli(['cwebp', 'enable'])
  for (const service of ['redis', 'memcached']) {
    cli([service, 'enable'])
    cli([service, 'status'])
    cli(['service', service, 'stop'])
    cli([service, 'start'])
    cli(['service', service, 'restart'])
    cli(['service', service, 'disable'])
    cli([service, 'start'], 1)
  }
  cli(['database', 'create', 'cli_probe', 'cli_user'], 0, { needle: 'Database password', answer: 'cli-test-password-123' })
  assert.match(cli(['database', 'list']), /cli_probe/)
  const dump = path.join(profile, 'cli-probe.sql')
  cli(['database', 'export', 'cli_probe', dump])
  cli(['database', 'import', 'cli_probe', dump])
  cli(['database', 'repair', 'cli_probe'])
  cli(['database', 'delete', 'cli_probe'], 0, { needle: 'Type delete:', answer: 'delete' })
  cli(['mariadb', 'stop'])
  assert.match(cli(['database', 'list'], 1), /Stopped/)
  cli(['mariadb', 'start']); cli(['mariadb', 'restart'])
  cli(['service', 'mariadb', 'status']); cli(['service', 'mariadb', 'stop']); cli(['service', 'mariadb', 'start']); cli(['service', 'mariadb', 'restart'])
  cli(['web', 'stop']); cli(['web', 'start']); cli(['web', 'restart'])
  cli(['service', 'web', 'status']); cli(['service', 'web', 'stop']); cli(['service', 'web', 'start']); cli(['service', 'web', 'restart'])
  cli(['stop', 'web']); cli(['start', 'web']); cli(['restart', 'web'])
  cli(['stop']); cli(['start']); cli(['restart'])
  cli(['runtime', 'restart'])
  cli(['runtime', 'stop'])
  cli(['runtime', 'start'])
  cli(['runtime', 'stop'])
  console.log('Live CLI runtime, status, services, PHP, extension, database and configuration routes passed.')
} finally {
  try { await runtime.resetRuntime(false) } catch (error) { console.error('Exact CLI fixture cleanup failed:', error); throw error }
  runtime.dispose()
  await rm(profile, { recursive: true, force: true })
  assert.deepEqual(inventory(), before, 'CLI fixture resources must be removed exactly')
}
