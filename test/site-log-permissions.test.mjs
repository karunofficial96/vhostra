import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('managed Site logs are initialized for the web worker without world write access', async () => {
  const runtime = await readFile(new URL('../electron/runtime.ts', import.meta.url), 'utf8')
  const entrypoint = await readFile(new URL('../runtime-image/entrypoint.sh', import.meta.url), 'utf8')
  assert.doesNotMatch(runtime, /fs\.chmod\(file,\s*0o666\)|fs\.open\(file,\s*["']a["'],\s*0o666\)/)
  assert.match(runtime, /fs\.mkdir\(directory,\s*\{ recursive: true, mode: 0o700 \}\)/)
  assert.match(entrypoint, /openlitespeed\) site_log_user=nobody; site_log_group=nogroup/)
  assert.match(entrypoint, /apache\|nginx\) site_log_user=www-data; site_log_group=www-data/)
  assert.match(entrypoint, /user = \$\{site_log_user\}/)
  assert.match(entrypoint, /chown "\$site_log_user:\$site_log_group" "\$site_log_dir"/)
  assert.match(entrypoint, /chmod 0700 "\$site_log_dir"/)
  assert.match(entrypoint, /chmod 0600 "\$site_log_file"/)
  assert.match(entrypoint, /\[ ! -L "\$site_log_file" \]/)
  assert.match(entrypoint, /vhostra-localhost-vhost\|\?\?\?\?\?\?\?\?-/)
})
