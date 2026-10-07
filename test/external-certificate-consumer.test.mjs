import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, linkSync, copyFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const script = path.resolve('runtime-image/verify-external-certificate.sh')
const openssl = spawnSync('openssl', ['version'], { stdio: 'ignore' }).status === 0

test('external TLS consumer validates names, key identity, SAN and regular files',
  { skip: process.platform === 'win32' || !openssl }, () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'vhostra-cert-consumer-'))
    const pub = path.join(root, 'public')
    const priv = path.join(root, 'private')
    mkdirSync(pub)
    mkdirSync(priv)
    const key = path.join(priv, 'localhost.key')
    const cert = path.join(pub, 'localhost.pem')
    const marker = path.join(pub, 'names.txt')
    const names = 'DNS:localhost,IP:127.0.0.1,DNS:site.test'
    const check = requested => spawnSync('sh', [script, root, requested], { encoding: 'utf8' })
    try {
      execFileSync('openssl', ['req', '-x509', '-nodes', '-days', '2', '-newkey', 'rsa:2048',
        '-subj', '/CN=localhost', '-addext', `subjectAltName=${names}`,
        '-keyout', key, '-out', cert], { stdio: 'ignore' })
      writeFileSync(marker, names)
      assert.equal(check(names).status, 0)
      assert.notEqual(check('DNS:localhost,IP:127.0.0.1,DNS:other.test').status, 0)
      writeFileSync(marker, 'DNS:localhost,IP:127.0.0.1,DNS:other.test')
      assert.match(check('DNS:localhost,IP:127.0.0.1,DNS:other.test').stderr, /missing DNS name/)
      writeFileSync(marker, names)
      execFileSync('openssl', ['genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048',
        '-out', path.join(priv, 'other.key')], { stdio: 'ignore' })
      copyFileSync(path.join(priv, 'other.key'), key)
      assert.match(check(names).stderr, /private key does not match/)
      rmSync(key)
      symlinkSync(path.join(priv, 'other.key'), key)
      assert.match(check(names).stderr, /missing or linked file/)
      rmSync(key)
      linkSync(path.join(priv, 'other.key'), key)
      assert.match(check(names).stderr, /hard-linked file/)
      rmSync(key)
      execFileSync('openssl', ['req', '-x509', '-nodes', '-days', '2', '-newkey', 'rsa:2048',
        '-subj', '/CN=localhost', '-keyout', key, '-out', cert], { stdio: 'ignore' })
      assert.match(check(names).stderr, /missing subject alternative names/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
