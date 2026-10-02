// Opt-in: node test/packaged-cli.mjs /absolute/path/to/package/launcher
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, mkdir, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const launcher = process.argv[2]
if (!launcher || !path.isAbsolute(launcher)) throw new Error('Pass the absolute packaged launcher path.')
const profile = await mkdtemp(path.join(os.tmpdir(), 'vhostra-packaged-cli-'))
const outside = await mkdtemp(path.join(os.tmpdir(), 'vhostra-outside-source-'))
const bin = path.join(outside, 'bin')
await mkdir(bin)
await symlink(launcher, path.join(bin, 'vhostra'))
const run = args => spawnSync('vhostra', args, { cwd: outside, encoding: 'utf8', timeout: 20000, env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, VHOSTRA_USER_DATA: profile, VHOSTRA_RUNTIME_PROJECT: `vhostra-packaged-cli-${process.pid}` } })
try {
  const help = run(['--help'])
  assert.equal(help.status, 0, help.stderr)
  assert.match(help.stdout, /Usage:\s+vhostra status/)
  assert.doesNotMatch(help.stdout, /npm run cli/)
  const status = run(['status'])
  assert.ok([0, 2].includes(status.status), status.stderr)
  assert.match(status.stdout, /Configured: (?:Enabled|Disabled) · Status:/)
  for (const target of ['apache', 'nginx', 'openlitespeed', 'web', 'php', 'mariadb', 'phpmyadmin', 'redis', 'memcached']) {
    const result = run(['status', target])
    assert.ok([0, 2].includes(result.status), `${target}: ${result.stderr}`)
    assert.match(result.stdout, /(?:Status:|Configured:)/, target)
  }
  for (const args of [['runtime', 'status'], ['service', 'list'], ['web', 'status'], ['mariadb', 'status'], ['php', 'status'], ['php', 'versions'], ['redis', 'status'], ['memcached', 'status'], ['sites', 'list'], ['vhost', 'list'], ['hosts', 'status']]) {
    const result = run(args)
    assert.ok([0, 1, 2].includes(result.status), `${args.join(' ')}: ${result.stderr}`)
    assert.doesNotMatch(result.stdout + result.stderr, /\bat .*\.mjs:\d+/)
    if (args[0] === 'php' && args[1] === 'status') assert.match(result.stdout, /Selected version:.*\nRuntime version:.*\nWeb server:.*\nIntegration:/)
    if (['redis', 'memcached'].includes(args[0]) && args[1] === 'status') assert.match(result.stdout, /Configured: (?:Enabled|Disabled) · Status:/)
  }
  const database = run(['database', 'list'])
  assert.equal(database.status, 1, database.stdout + database.stderr)
  assert.match(database.stderr, /MariaDB is Not Created/)
  const malformed = run(['unknown-command'])
  assert.equal(malformed.status, 64)
  console.log('Packaged CLI passed from outside source: help, status, database prerequisite, invalid syntax.')
} finally {
  await rm(profile, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
}
