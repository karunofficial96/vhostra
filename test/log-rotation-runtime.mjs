// Focused opt-in host log rotation acceptance; one-off runtime, no services.
import assert from 'node:assert/strict'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { VhostraStore } from '../dist-electron/store.js'
import { DockerRuntimeController } from '../dist-electron/runtime.js'
const root = await mkdtemp(path.join(os.tmpdir(), 'vhostra-log-rotation-')); const project = await mkdtemp(path.join(os.tmpdir(), 'vhostra-log-site-'))
const store = new VhostraStore(root); const scope = `vhostra-log-rotation-${process.pid}`; const runtime = new DockerRuntimeController(store.layout, () => store.getState(), undefined, scope)
let passed = false
try {
  const state = await store.addSite({ name: 'Rotation probe', documentRoot: project, url: 'http://rotation.test' }); state.settings.selectedWebServer = 'nginx'; state.settings.php.extensions = ['apcu']; await store.saveSettings(state.settings); await runtime.generate(await store.getState())
  const host = (await store.getState()).virtualHosts.find(host => !host.builtIn)
  for (let iteration = 0; iteration < 4; iteration++) {
    console.log(await runtime.compose(['run', '--rm', '--no-deps', '--entrypoint', '/bin/sh', 'runtime', '-c', `dd if=/dev/zero bs=1M count=6 >> /var/log/vhostra/sites/${host.id}/access.log 2>/dev/null; /usr/sbin/logrotate --verbose --state /tmp/rotation.state /etc/vhostra/php/site-logrotate.conf 2>&1; stat -c %s /var/log/vhostra/sites/${host.id}/access.log`]))
    for (let attempt = 0; (await stat(host.logs.paths.access)).size && attempt < 20; attempt++) await new Promise(resolve => setTimeout(resolve, 100))
    assert.equal((await stat(host.logs.paths.access)).size, 0)
  }
  assert.ok((await stat(`${host.logs.paths.access}.3`)).size >= 6 * 1024 * 1024); await assert.rejects(stat(`${host.logs.paths.access}.4`), /ENOENT/)
  console.log('Real host log threshold rotation/copytruncate, three-copy retention and original active-file preservation passed.'); passed = true
} finally {
  await runtime.resetRuntime(); await runtime.pauseBackgroundWork(); runtime.dispose()
  if (passed) await Promise.all([root, project].map(directory => rm(directory, { recursive: true, force: true })))
  else console.error(`Retained log-rotation diagnostics: ${root}`)
}
