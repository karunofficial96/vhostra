// Opt-in macOS acceptance for the web/PHP config boundary. Never selects a Store.
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { executeProtectedTransaction } from '../dist-electron/protected-transaction.js'
import { authoritativeWebFile, renderWebRuntimeFiles, runtimeWebFile } from '../dist-electron/web-runtime-config.js'

const inactiveRoot = '/Library/Application Support/Vhostra'
const script = fileURLToPath(import.meta.url)
const quoteShell = value => `'${value.replace(/'/g, `'\''`)}'`
const quoteApple = value => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
const fail = message => { throw new Error(message) }
const safeRun = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: options.timeout ?? 30000,
    uid: options.uid, gid: options.gid, env: options.env, stdio: ['ignore', 'pipe', 'pipe'] })
  if (result.error || result.status !== 0) throw new Error(`${options.label ?? path.basename(command)} failed (exit ${result.status ?? 'unknown'})`)
  return result.stdout.trim()
}
const checkFile = async (file, uid, mode) => {
  const stat = await fs.lstat(file)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== uid || (stat.mode & 0o777) !== mode)
    fail(`Staged ${path.basename(file)} has unsafe ownership or permissions`)
}
const request = (port, host) => new Promise((resolve, reject) => {
  const req = http.get({ hostname: '127.0.0.1', port, path: '/index.php', headers: { Host: host }, timeout: 10000 }, res => {
    let body = ''; res.on('data', chunk => { body += chunk }); res.on('end', () => resolve({ status: res.statusCode, body, site: res.headers['x-vhostra-site'] }))
  })
  req.on('timeout', () => req.destroy(new Error('staged HTTP deadline')))
  req.on('error', reject)
})

async function worker(uid, gid, home, dockerPath) {
  if (process.platform !== 'darwin' || process.getuid?.() !== 0 || !Number.isInteger(uid) || uid < 1 || !Number.isInteger(gid) || gid < 1)
    fail('Web staging requires one administrator-authorized worker')
  const rootStat = await fs.lstat(inactiveRoot)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || rootStat.uid !== 0 || (rootStat.mode & 0o777) !== 0o755)
    fail('Inactive Vhostra system root is not the verified shared root')
  const scope = `vhostra-web-stage-${randomUUID()}`
  const stage = path.join(inactiveRoot, `.Vhostra-web-stage-${randomUUID()}`)
  const siteId = randomUUID()
  const builtInId = 'vhostra-localhost-vhost'
  const siteName = 'web-stage.local.test'
  const model = { server: 'openlitespeed', phpVersion: '8.3', httpsEnabled: false, sites: [
    { id: builtInId, hostname: 'localhost', aliases: [], builtIn: true, indexFiles: ['index.html'], rewriteEnabled: true },
    { id: siteId, hostname: siteName, aliases: ['www.web-stage.local.test'], builtIn: false, indexFiles: ['index.php', 'index.html'], rewriteEnabled: true },
  ] }
  const roots = { configuration: stage, data: stage, logs: path.join(stage, 'logs') }
  const publicRoot = path.join(stage, 'runtime-config/web')
  const localRoot = path.join(stage, 'service-data/localhost/public')
  const siteRoot = path.join(stage, 'disposable-site', siteId)
  const logRoot = path.join(stage, 'logs')
  const dockerEnv = { ...process.env, HOME: home, DOCKER_HOST: `unix://${path.join(home, '.docker/run/docker.sock')}` }
  let dockerOperations = 0
  const docker = (args, timeout = 30000) => {
    dockerOperations++
    return safeRun(dockerPath, args, { uid, gid, env: dockerEnv, timeout, label: `isolated Docker ${args[0]}` })
  }
  const sha = source => createHash('sha256').update(source).digest('hex')
  const milestones = { helper_started: Date.now() }
  const passed = {}
  let active = ''
  try {
    await fs.mkdir(stage, { mode: 0o755 })
    await fs.mkdir(localRoot, { recursive: true, mode: 0o755 })
    await fs.mkdir(siteRoot, { recursive: true, mode: 0o755 })
    await fs.mkdir(logRoot, { recursive: true, mode: 0o755 })
    for (const id of [builtInId, siteId]) await fs.mkdir(path.join(logRoot, 'sites', id), { recursive: true, mode: 0o700 })
    for (const dir of [localRoot, path.dirname(localRoot), siteRoot, path.dirname(siteRoot), logRoot, path.join(logRoot, 'sites'), ...[builtInId, siteId].map(id => path.join(logRoot, 'sites', id))])
      await fs.chown(dir, uid, gid)
    await fs.writeFile(path.join(localRoot, 'index.html'), 'inactive web staging localhost', { mode: 0o644 })
    await fs.writeFile(path.join(siteRoot, 'index.php'), '<?php echo "web-stage-proof|".PHP_SAPI."|".ini_get("mysqli.default_socket")."|".ini_get("expose_php");', { mode: 0o644 })
    await fs.chown(path.join(siteRoot, 'index.php'), uid, gid)
    await fs.chown(path.join(localRoot, 'index.html'), uid, gid)
    // Use an existing inspected runtime image with PHP 8.3. If no current
    // matching image exists, fail without pulling an unrelated image.
    const candidates = docker(['image', 'ls', '--format', '{{.Repository}}:{{.Tag}}'])
      .split('\n').filter(name => /^vhostra-runtime:build-[a-f0-9]{24}$/.test(name))
    const entrypointHash = sha(await fs.readFile(fileURLToPath(new URL('../runtime-image/entrypoint.sh', import.meta.url))))
    const webScriptHash = sha(await fs.readFile(fileURLToPath(new URL('../runtime-image/web-server.sh', import.meta.url))))
    let image = ''
    for (const candidate of candidates) {
      try {
        const entry = docker(['run', '--rm', '--pull', 'never', '--network', 'none', '--entrypoint', 'sha256sum', candidate, '/usr/local/bin/vhostra-entrypoint']).split(/\s+/)[0]
        const web = docker(['run', '--rm', '--pull', 'never', '--network', 'none', '--entrypoint', 'sha256sum', candidate, '/usr/local/bin/vhostra-web-server']).split(/\s+/)[0]
        docker(['run', '--rm', '--pull', 'never', '--network', 'none', '--entrypoint', 'test', candidate, '-x', '/usr/local/lsws/lsphp83/bin/lsphp'])
        if (entry === entrypointHash && web === webScriptHash) { image = candidate; break }
      } catch { /* inspect the next local managed image */ }
    }
    if (!image) fail('No local Vhostra runtime image matches the current scripts and PHP 8.3')
    for (const server of ['openlitespeed', 'apache', 'nginx']) {
      model.server = server
      const published = await executeProtectedTransaction({ version: 1, operations: [{ type: 'web-runtime-config', model }] }, roots, path.join(stage, 'hosts'))
      if (published.completed !== 1) fail('Web runtime publication did not complete')
      for (const { key, body } of renderWebRuntimeFiles(model)) {
        const privateFile = path.join(stage, 'configuration', key)
        const publicFile = path.join(publicRoot, key.slice('runtime/'.length))
        await checkFile(privateFile, 0, 0o600)
        await checkFile(publicFile, 0, 0o644)
        const privateBytes = await fs.readFile(privateFile, 'utf8')
        const publicBytes = await fs.readFile(publicFile, 'utf8')
        if (privateBytes !== authoritativeWebFile(body) || publicBytes !== runtimeWebFile(privateBytes)
          || /password|secret|!include|IncludeOptional/i.test(publicBytes)) fail('Web runtime output is not the approved non-secret representation')
      }
      milestones[`${server}_config_published`] = Date.now()
      const files = ['openlitespeed', 'php', ...(server === 'openlitespeed' ? [] : [server])]
      const name = `${scope}-${server}`
      active = name // Docker may create a record before rejecting a bind.
      const args = ['run', '-d', '--pull', 'never', '--name', name, '-p', '127.0.0.1::8088',
        '-e', `VHOSTRA_WEB_SERVER=${server}`, '-e', 'VHOSTRA_LSPHP_VERSION=83', '-e', 'VHOSTRA_HTTPS=false',
        '-e', 'VHOSTRA_REDIS=false', '-e', 'VHOSTRA_MEMCACHED=false', '-e', 'VHOSTRA_OPCACHE=true',
        '-e', 'VHOSTRA_PHP_EXTENSIONS=', '-e', 'VHOSTRA_PHP_DISABLED_EXTENSIONS=',
        '-e', `VHOSTRA_PMA_PASSWORD=${randomBytes(24).toString('hex')}`,
        '-v', `${localRoot}:/var/www/html`, '-v', `${siteRoot}:/var/www/vhostra/${siteId}:ro`,
        '-v', `${logRoot}:/var/log/vhostra`,
        ...files.flatMap(service => ['-v', `${path.join(publicRoot, service)}:/etc/vhostra/${service}:ro`]), image]
      docker(args, 40000)
      const inspected = JSON.parse(docker(['inspect', name]))[0]
      if (inspected.Mounts.some(mount => mount.Source.startsWith(`${path.join(stage, 'configuration')}${path.sep}`))) fail('Docker received protected web configuration')
      if (inspected.Mounts.some(mount => ['/etc/vhostra/apache', '/etc/vhostra/nginx'].includes(mount.Destination) && !files.includes(path.basename(mount.Destination))))
        fail('Docker received an unselected frontend configuration')
      for (const service of files) {
        const mounted = inspected.Mounts.find(mount => mount.Destination === `/etc/vhostra/${service}`)
        if (!mounted || mounted.RW !== false || mounted.Source !== path.join(publicRoot, service)) fail('Generated web mount is missing or writable')
        const attempt = spawnSync(dockerPath, ['exec', name, 'sh', '-c', `printf probe >> /etc/vhostra/${service}/${service === 'openlitespeed' ? 'localhost.conf' : service === 'apache' ? 'vhostra.conf' : service === 'nginx' ? 'default.conf' : 'vhostra.ini'}`],
          { uid, gid, env: dockerEnv, encoding: 'utf8', timeout: 15000, stdio: 'ignore' })
        dockerOperations++
        if (attempt.status === 0) fail('Container modified generated web configuration')
      }
      const port = Number(inspected.NetworkSettings?.Ports?.['8088/tcp']?.[0]?.HostPort)
      if (!Number.isInteger(port) || port < 1) fail('Staged web port did not publish')
      let response = null
      const deadline = Date.now() + 60000
      while (Date.now() < deadline) {
        try { response = await request(port, siteName); if (response.status === 200) break } catch {}
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
      if (!response || response.status !== 200 || response.site !== siteId
        || response.body !== `web-stage-proof|${server === 'openlitespeed' ? 'litespeed' : 'fpm-fcgi'}|/run/mysqld/mysqld.sock|`)
        {
          const parts = response?.body?.startsWith('web-stage-proof|') ? response.body.split('|') : []
          fail(`${server} did not load generated vhost and PHP settings (http=${response?.status ?? 'none'}, site=${response?.site === siteId}, marker=${parts.length > 0}, sapi=${parts[1] ?? 'none'}, socket=${parts[2] === '/run/mysqld/mysqld.sock' ? 'expected' : 'other'}, expose=${parts[3] === '' ? 'off' : 'other'})`)
        }
      const alias = await request(port, 'www.web-stage.local.test')
      if (alias.status !== 200 || alias.site !== siteId || alias.body !== response.body) fail(`${server} alias routing failed`)
      const localhost = await request(port, 'localhost')
      if (localhost.site === siteId || localhost.body.includes('web-stage-proof')) fail(`${server} default vhost routing failed`)
      const expectedUid = server === 'openlitespeed' ? 65534 : 33
      const logFile = path.join(logRoot, 'sites', siteId, 'access.log')
      if (((await fs.lstat(logFile)).mode & 0o777) !== 0o600) fail(`${server} Site log is not 0600 on the host`)
      if (docker(['exec', name, 'stat', '-c', '%u:%g %a', `/var/log/vhostra/sites/${siteId}/access.log`]) !== `${expectedUid}:${expectedUid} 600`)
        fail(`${server} Site log owner or mode is wrong in the container`)
      const workerName = server === 'openlitespeed' ? 'nobody' : 'www-data'
      const workers = docker(['exec', name, 'ps', '-eo', 'user=,comm='])
      if (!workers.split('\n').some(line => line.trim().startsWith(`${workerName} `))) fail(`${server} worker identity was not observed`)
      docker(['exec', '-u', workerName, name, 'sh', '-c', `printf worker-proof >> /var/log/vhostra/sites/${siteId}/access.log`])
      if (((await fs.lstat(logFile)).mode & 0o777) !== 0o600) fail(`${server} Site log changed mode after worker append`)
      passed[server] = { start: true, php: true, routing: true, setting: true, logs0600: true, worker: workerName }
      docker(['rm', '-f', name])
      active = ''
    }
    milestones.servers_completed = Date.now()
    return { result: 'PASS', passed, privilegeInvocations: 1, dockerOperations, helperPid: process.pid, milestones }
  } finally {
    if (active) { try { docker(['rm', '-f', active], 20000) } catch {} }
    await fs.rm(stage, { recursive: true, force: true })
  }
}

if (process.argv[2] === '--worker') {
  worker(Number(process.argv[3]), Number(process.argv[4]), process.argv[5], process.argv[6])
    .then(result => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch(error => { process.stderr.write(`${error.message.slice(0, 220)}\n`); process.exitCode = 1 })
} else {
  if (process.platform !== 'darwin' || process.getuid?.() === 0) fail('Run web staging as an ordinary macOS user')
  const dockerPath = safeRun('/usr/bin/which', ['docker'], { label: 'Docker lookup' })
  const command = [process.execPath, script, '--worker', String(process.getuid()), String(process.getgid()), os.homedir(), dockerPath].map(quoteShell).join(' ')
  process.stdout.write('macOS may request one administrator authorization for isolated web staging. Approve it on this Mac; do not enter a password in chat. Production remains on the legacy Store.\n')
  const child = spawn('osascript', ['-e', `do shell script ${quoteApple(command)} with administrator privileges`], { stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''; let errors = ''
  child.stdout.on('data', chunk => { output += String(chunk).slice(0, 4096) })
  child.stderr.on('data', chunk => { errors += String(chunk).slice(0, 1024) })
  child.on('close', code => {
    if (code !== 0) { process.stderr.write(`Native web staging failed (status ${code ?? 'unknown'}; ${errors.trim().slice(0, 280)}).\n`); process.exitCode = 1; return }
    try {
      const result = JSON.parse(output.trim())
      if (result.result !== 'PASS') fail('Native web staging did not pass')
      try { process.kill(result.helperPid, 0); fail('Privileged web staging worker remained running') }
      catch (error) { if (error.code !== 'ESRCH') throw error }
      process.stdout.write(`${JSON.stringify({ result: 'PASS', passed: result.passed, privilegeInvocations: 1,
        dockerOperations: result.dockerOperations, helperExited: true })}\n`)
    } catch { process.stderr.write('Native web staging returned an invalid bounded result.\n'); process.exitCode = 1 }
  })
}
