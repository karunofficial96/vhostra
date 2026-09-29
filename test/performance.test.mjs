import test from 'node:test'
import { createServer } from 'node:http'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { VhostraStore } from '../dist-electron/store.js'
import { DockerRuntimeController } from '../dist-electron/runtime.js'

test('build identity includes meaningful build inputs and is shared by candidates', async () => {
 const root=await mkdtemp(path.join(os.tmpdir(),'vhostra-image-key-'))
 const store=new VhostraStore(root,path.resolve('dist-welcome')); const state=await store.getState()
 const runtime=new DockerRuntimeController(store.layout,()=>store.getState())
 const candidate=new DockerRuntimeController(store.layout,()=>store.getState(),undefined,'vhostra-candidate-test')
 try {
  await runtime.generate(state); const first=runtime.imageName
  await candidate.generate(state); assert.equal(candidate.imageName,first)
  state.settings.selectedWebServer='apache'; state.settings.optionalServices.redis=true; state.settings.ports.http++
  await runtime.generate(state); assert.equal(runtime.imageName,first)
  state.settings.php.extensions.push('apcu'); await runtime.generate(state); assert.notEqual(runtime.imageName,first)
  const commands=[]; runtime.compose=async args=>{commands.push(args);return ''}; runtime.docker=async args=>args[1]==='inspect' ? JSON.stringify([{Config:{Labels:{'com.vhostra.managed':'true','com.vhostra.purpose':'runtime-image'}}}]) : 'existing-image-id'
  await runtime.upCompatibleImage(); assert.deepEqual(commands,[['up','--detach','--no-build','--pull','never','--no-deps','runtime']])
 } finally { runtime.dispose();candidate.dispose();await rm(root,{recursive:true,force:true}) }
})

test('cache cleanup preserves unknown labels, foreign tags, container references, and recovery leases', async () => {
 const runtime=new DockerRuntimeController({runtime:{apache:'/nonexistent/runtime/apache'}},async()=>({}))
 const labels={'com.vhostra.managed':'true','com.vhostra.purpose':'runtime-image'}
 const tag=n=>`vhostra-runtime:build-${String(n).padStart(24,'0')}`
 const images=Array.from({length:12},(_,n)=>({Id:`id${n}`,Created:new Date(Date.UTC(2026,8,27,0,100-n)).toISOString(),RepoTags:[tag(n)],Config:{Labels:{...labels}}}))
 images[6].RepoTags.push('vhostra-runtime:recovery-lease')
 images[7].Config.Labels={}
 images[8].RepoTags.push('unrelated:tag')
 const removed=[]
 runtime.docker=async args=> {
  if(args[0]==='image'&&args[1]==='ls') return images.map(v=>v.Id).join('\n')
  if(args[0]==='image'&&args[1]==='inspect') return JSON.stringify(images)
  if(args[0]==='ps') return 'foreign-container'
  if(args[0]==='inspect') return JSON.stringify([{Image:'id9'}])
  if(args[0]==='image'&&args[1]==='rm') {removed.push(...args.slice(2));return ''}
  throw Error(`Unexpected command ${args}`)
 }
 try { await runtime.cleanupImages();assert.deepEqual(removed,[tag(10),tag(11)]) }
 finally { runtime.dispose() }
})

test('snapshot retention only removes completed owned automatic imports', async () => {
 const fs=await import('node:fs/promises'); const root=await mkdtemp(path.join(os.tmpdir(),'vhostra-retention-'))
 const store=new VhostraStore(root,path.resolve('dist-welcome'))
 try {
  await store.getState()
  for(let index=0;index<12;index++) {
   const file=path.join(store.layout.backups,`before-import-2026-09-${String(index+1).padStart(2,'0')}T00-00-00-000Z.json`)
   await store.exportBundle(file); const content=JSON.parse(await fs.readFile(file,'utf8'))
   content.manifest.automaticRecovery={owner:'vhostra',state:'completed',createdAt:new Date(Date.UTC(2026,8,index+1)).toISOString()}
   await fs.writeFile(file,JSON.stringify(content))
  }
  const protectedFile=path.join(store.layout.backups,'before-import-2026-08-01T00-00-00-000Z.json')
  await store.exportBundle(protectedFile); const active=JSON.parse(await fs.readFile(protectedFile,'utf8'))
  active.manifest.automaticRecovery={owner:'vhostra',state:'active',createdAt:'2026-08-01T00:00:00Z'}
  await fs.writeFile(protectedFile,JSON.stringify(active)); await fs.writeFile(path.join(store.layout.backups,'my-backup.json'),'user-owned')
  await store.retainCompletedImportSnapshots()
  const files=await fs.readdir(store.layout.backups)
  assert.equal(files.length,12);assert.ok(files.includes(path.basename(protectedFile)));assert.ok(files.includes('my-backup.json'))
  assert.ok(!files.includes('before-import-2026-09-01T00-00-00-000Z.json'))
 } finally { await rm(root,{recursive:true,force:true}) }
})

test('enabling an installed PHP extension never refreshes package indexes or reinstalls it', async () => {
 const server=createServer((_request,response)=>response.end(JSON.stringify(['apcu'])))
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const state={settings:{selectedPhpVersion:'8.3',selectedWebServer:'openlitespeed',ports:{http:server.address().port}}}
 const runtime=new DockerRuntimeController({runtime:{apache:'/nonexistent/runtime/apache'}},async()=>state)
 runtime.snapshot={state:'running',message:'running',services:['runtime'],updatedAt:''}
 runtime.availablePhpPackages=async()=>['apcu'];runtime.installedPhpPackages=async()=>['apcu']
 runtime.configureRuntimePhpExtension=async(_php,id,enabled)=>{assert.equal(id,'apcu');assert.equal(enabled,true)}
 runtime.listPhpExtensions=async()=>[{id:'apcu',installed:true,enabled:true}]
 runtime.refresh=async()=>runtime.current()
 const commands=[];runtime.compose=async args=>{commands.push(args);return args.at(-1).includes('dpkg-query')?'installed':''}
 try { await runtime.managePhpExtension('apcu','enable');await runtime.operation;assert.equal(commands.some(args=>args.some(value=>value.includes('apt-get'))),false) }
 finally { runtime.dispose(); await new Promise(resolve=>server.close(resolve)) }
})
test('database cache retains two recent builds and protects referenced or foreign-tagged images', async()=>{
 const runtime=new DockerRuntimeController({runtime:{apache:'/nonexistent/runtime/apache'}},async()=>({}));const tag=n=>`vhostra-mariadb:build-${String(n).padStart(24,'0')}`;
 const images=Array.from({length:5},(_,n)=>({Id:`db${n}`,Created:`2026-09-${20-n}`,RepoTags:[tag(n)],Config:{Labels:{'com.vhostra.managed':'true','com.vhostra.purpose':'mariadb-image'}}}));images[3].RepoTags.push('other-project:keep');const removed=[];
 runtime.docker=async args=>{if(args[0]==='image'&&args[1]==='ls')return images.map(row=>row.Id).join('\n');if(args[0]==='image'&&args[1]==='inspect')return JSON.stringify(images);if(args[0]==='ps')return 'container';if(args[0]==='inspect')return JSON.stringify([{Image:'db2'}]);if(args[0]==='image'&&args[1]==='rm'){removed.push(...args.slice(2));return ''}throw Error('Unexpected command')};
 try{await runtime.cleanupImages();assert.deepEqual(removed,[tag(4)])}finally{runtime.dispose()}
})
