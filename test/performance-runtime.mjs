// Opt-in, sequential runtime performance/architecture acceptance. No live profile.
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import https from 'node:https'
import http from 'node:http'
import { VhostraStore } from '../dist-electron/store.js'
import { DockerRuntimeController } from '../dist-electron/runtime.js'
const root = await mkdtemp(path.join(os.tmpdir(), 'vhostra-performance-'))
const site = await mkdtemp(path.join(os.tmpdir(), 'vhostra-performance-site-'))
const scope = `vhostra-performance-${process.pid}`
const store = new VhostraStore(root, path.resolve('dist-welcome'))
const runtime = new DockerRuntimeController(store.layout, () => store.getState(), undefined, scope)
const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 20000 })
let last = ''
runtime.subscribe(() => { const snapshot=runtime.current(); if(snapshot.message!==last) { last=snapshot.message; console.log(last) } })
const fetchSite = (pathName, host = 'localhost') => new Promise((resolve, reject) => {
 http.get({ host: '127.0.0.1', port: 29880, path: pathName, headers: { Host: host } }, response => {
  let text=''; response.on('data', value => text += value); response.on('end', () => resolve({ status: response.statusCode, text }))
 }).on('error', reject)
})
const tls = () => new Promise((resolve,reject)=> { https.get({host:'127.0.0.1',port:29843,path:'/vhostra-health.php',rejectUnauthorized:false,headers:{Host:'localhost'}},response=>{let body='';response.on('data',v=>body+=v);response.on('end',()=>resolve({status:response.statusCode,body}))}).on('error',reject) })
const before = docker(['ps','-a','--format','{{.ID}}']).trim().split('\n').sort()
const processes = () => docker(['exec',`${scope}-runtime-1`,'ps','-eo','comm=']).trim().split('\n').map(v=>v.trim())
try {
 const state = await store.getState()
 state.settings.php.extensions = ['apcu']
 state.settings.ports = {http:29880,phpMyAdmin:29881,mariadb:29806,https:29843,redis:29879,memcached:29811}
 await store.saveSettings(state.settings)
 await chmod(site,0o755)
 await writeFile(path.join(site,'index.php'),'<?php if (isset($_GET["cache_probe"])) { apcu_store("vhostra_probe", "works"); echo apcu_fetch("vhostra_probe"); exit; } echo "permalink:" . $_SERVER["REQUEST_URI"] . ":php:" . PHP_VERSION;')
 await writeFile(path.join(site,'.htaccess'),'RewriteEngine On\nRewriteCond %{REQUEST_FILENAME} !-f\nRewriteCond %{REQUEST_FILENAME} !-d\nRewriteRule . /index.php [L]\n')
 await store.addSite({name:'Performance route probe',documentRoot:site,url:'http://resource.test:29880/'})
 for (const server of ['openlitespeed','apache','nginx']) {
  const current = await store.getState(); await store.saveSettings({...current.settings, selectedWebServer:server})
  await runtime.start()
  assert.equal(runtime.current().progress,undefined)
  const builds = runtime.diagnostics().builds
  await runtime.start()
  assert.equal(runtime.diagnostics().builds, builds, 'Ordinary Start must reuse its compatible image')
  const names=processes()
  for (const [choice,processName] of [['openlitespeed','openlitespeed'],['apache','apache2'],['nginx','nginx']]) assert.equal(names.includes(processName), choice===server, `${server}: unexpected ${processName}`)
  for (const disabled of ['redis-server','memcached','sleep']) assert.equal(names.includes(disabled),false,`${disabled} must be dormant`)
  if (server!=='openlitespeed') assert.equal(names.includes('lsphp'),false)
  const response=await fetchSite('/article/example?probe=1','resource.test')
  if(response.status!==200) console.log('ROUTE_DIAGNOSTIC', docker(['exec',`${scope}-runtime-1`,'sh','-c','cat /etc/vhostra/openlitespeed/vhostra-maps.conf; cat /etc/vhostra/openlitespeed/sites/*.conf; cat /usr/local/lsws/conf/httpd_config.conf; tail -50 /usr/local/lsws/logs/error.log; ls -la /var/www/vhostra/*']))
  assert.equal(response.status,200); assert.match(response.text,/permalink:\/article\/example\?probe=1:php:8\.5/)
  const cache=await fetchSite('/index.php?cache_probe=1','resource.test'); assert.equal(cache.text,'works','APCu must function in the selected PHP SAPI')
  const missing=await fetchSite('/missing.php'); assert.equal(missing.status,404)
  const secure=await tls(); assert.equal(secure.status,200); assert.match(secure.body,/vhostra-lsphp:8\.5/)
  assert.ok((await runtime.listPhpExtensions()).some(item=>item.category==='available'), 'Offline extension catalog survives apt cleanup')
  if(server==='openlitespeed') await runtime.createDatabase({name:'resource_probe',charset:'utf8mb4',username:'resource_user',password:'performance-test-password'})
  assert.ok((await runtime.listDatabases()).includes('resource_probe'))
  await new Promise(resolve=>setTimeout(resolve,15000))
  console.log('MEASUREMENT',JSON.stringify({server,stats:await runtime.resourceUsage(),diagnostics:runtime.diagnostics(),image:docker(['inspect',`${scope}-runtime-1`,'--format','{{.Image}}']).trim(),processes:docker(['exec',`${scope}-runtime-1`,'ps','-eo','pid,comm,rss'])}))
  const container=JSON.parse(docker(['inspect',`${scope}-runtime-1`]))[0]
  console.log('IMAGE_BYTES',docker(['image','inspect',container.Image,'--format','{{.Size}}']).trim())
  await runtime.stop()
 }
 for (const enabled of [true,false]) {
  const current=await store.getState(); await store.saveSettings({...current.settings,optionalServices:{redis:enabled,memcached:enabled}})
  await runtime.start(); const names=processes()
  assert.equal(names.includes('redis-server'),enabled); assert.equal(names.includes('memcached'),enabled)
  await runtime.stop()
 }
 console.log('All selected-server, PHP, HTTPS, database, cache daemon, catalog, and image-reuse checks passed.')
} finally {
 runtime.dispose()
 try { await runtime.compose(['down']) } finally { await Promise.all([root,site].map(directory=>rm(directory,{recursive:true,force:true}))) }
 assert.deepEqual(docker(['ps','-a','--format','{{.ID}}']).trim().split('\n').sort(),before,'Unrelated container inventory must remain unchanged')
}
