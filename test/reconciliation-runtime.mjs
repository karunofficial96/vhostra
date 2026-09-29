import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { execFileSync } from 'node:child_process'
import { VhostraStore } from '../dist-electron/store.js'
import { DockerRuntimeController } from '../dist-electron/runtime.js'
import { exportFullBackup, previewFullBackup, restoreFullDatabase, proveDatabaseEquality } from '../dist-electron/backup.js'
const profile = await mkdtemp(path.join(os.tmpdir(), 'vhostra-reconcile-live-')); const scope = `vhostra-reconcile-${process.pid}`
const store = new VhostraStore(profile, path.resolve('dist-welcome')); let runtime = new DockerRuntimeController(store.layout, () => store.getState(), undefined, scope)
const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 120000 })
const inventory = () => docker(['ps', '-a', '--format', '{{.ID}} {{.Names}} {{.State}}']).trim().split('\n').sort()
const original = inventory(); let complete = false
const progress = message => console.log(message)
let lastStatus = ''; runtime.subscribe(() => { const message = runtime.current().message; if (message !== lastStatus) { console.log(message); lastStatus = message } })
const sql = statement => runtime.databaseCompose(['exec', '-T', 'mariadb', 'mariadb', '-uroot', '-N', '-e', statement])
const health = port => new Promise((resolve, reject) => http.get({host:'127.0.0.1',port,path:'/vhostra-cache-health.php',headers:{Host:'localhost'},timeout:10000}, response => {let text='';response.on('data',chunk=>text+=chunk);response.on('end',()=>resolve(text))}).on('error',reject))
try {
 console.log('PROFILE',profile,'SCOPE',scope)
 const state = await store.getState(); const settings = {...state.settings,selectedWebServer:'nginx',selectedPhpVersion:'8.4',optionalServices:{redis:true,memcached:true},ports:{http:35180,https:35443,phpMyAdmin:35181,mariadb:35306,redis:6379,memcached:11211}}
 await store.saveSettings(settings)
 const project=path.join(profile,'external');await mkdir(project); // Use a genuinely external directory below.
 const external=await mkdtemp(path.join(os.tmpdir(),'vhostra-reconcile-project-'));await writeFile(path.join(external,'sentinel'),'untouched')
 await store.addSite({name:'Backup fixture',url:'http://backup.test:35180',documentRoot:external,aliases:['www.backup.test']})
 await runtime.start(); assert.match(await health(35180),/redis:localhost:ok/);assert.match(await health(35180),/memcached:localhost:ok/)
 await runtime.createDatabase({name:'restore_fixture',charset:'utf8mb4',username:'restore_user',password:'isolated-backup-password'})
 await sql("DROP DATABASE IF EXISTS test; REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'restore_user'@'localhost'; CREATE ROLE restore_reader; GRANT SELECT ON restore_fixture.* TO restore_reader; GRANT restore_reader TO 'restore_user'@'localhost'; SET DEFAULT ROLE restore_reader FOR 'restore_user'@'localhost'; CREATE TABLE restore_fixture.identity(id INT PRIMARY KEY, value VARCHAR(40)); INSERT INTO restore_fixture.identity VALUES(1,'original');")
 const backup=path.join(profile,'full.json');await exportFullBackup(store,runtime,backup,progress)
 const manifest=JSON.parse(await readFile(backup,'utf8'));assert.doesNotMatch(JSON.stringify(manifest),/isolated-backup-password|IDENTIFIED|authentication_string/)
 let plan=await previewFullBackup(backup,runtime,progress);assert.equal(plan.items.find(item=>item.category==='database').disposition,'conflict');assert.ok(plan.items.filter(item=>item.category!=='database').every(item=>item.disposition==='equivalent'))
 assert.equal((await proveDatabaseEquality(plan,runtime,'database:restore_fixture',path.join(profile,'compare'))).disposition,'equivalent')
 let result=await restoreFullDatabase(plan,runtime,{},store.layout.backups,progress);assert.equal(result.summary.imported,0);assert.equal(result.summary.skipped,5)
 await sql("UPDATE restore_fixture.identity SET value='changed'; GRANT INSERT ON restore_fixture.* TO 'restore_user'@'localhost';")
 plan=await previewFullBackup(backup,runtime,progress);assert.equal(plan.items.find(item=>item.category==='account').disposition,'conflict')
 await assert.rejects(restoreFullDatabase(plan,runtime,{},store.layout.backups,progress),/review required/)
 result=await restoreFullDatabase(plan,runtime,{'database:restore_fixture':'keep',[plan.items.find(item=>item.category==='account').key]:'keep'},store.layout.backups,progress);assert.equal((await sql('SELECT value FROM restore_fixture.identity')).trim(),'changed')
 plan=await previewFullBackup(backup,runtime,progress);const replace=Object.fromEntries(plan.items.filter(item=>item.disposition==='conflict').map(item=>[item.key,'replace']))
 result=await restoreFullDatabase(plan,runtime,replace,store.layout.backups,progress);assert.equal((await sql('SELECT value FROM restore_fixture.identity')).trim(),'original');assert.equal(result.summary.replaced,2)
 await sql("DROP DATABASE restore_fixture; DROP USER 'restore_user'@'localhost'; DROP ROLE restore_reader;")
 plan=await previewFullBackup(backup,runtime,progress);assert.ok(plan.items.filter(item=>item.category!=='configuration').every(item=>item.disposition==='new'));result=await restoreFullDatabase(plan,runtime,{},store.layout.backups,progress);assert.equal(result.summary.imported,3);assert.equal((await sql('SELECT value FROM restore_fixture.identity')).trim(),'original')
 // A real partial SQL import failure must recover original data and account state.
 await sql("UPDATE restore_fixture.identity SET value='pre-failure'; GRANT UPDATE ON restore_fixture.* TO 'restore_user'@'localhost';")
 plan=await previewFullBackup(backup,runtime,progress);const decisions=Object.fromEntries(plan.items.filter(item=>item.disposition==='conflict').map(item=>[item.key,'replace']));const importDatabase=runtime.importDatabase.bind(runtime);let inject=true
 runtime.importDatabase=async(name,file)=>{const value=await importDatabase(name,file);if(inject){inject=false;throw Error('Injected after actual import')}return value}
 await assert.rejects(restoreFullDatabase(plan,runtime,decisions,store.layout.backups,progress),/Original data\/accounts recovered/);runtime.importDatabase=importDatabase
 assert.equal((await sql('SELECT value FROM restore_fixture.identity')).trim(),'pre-failure');assert.match((await sql("SHOW GRANTS FOR 'restore_user'@'localhost'")),/UPDATE/)
 // Account/role failure after real writes must recover identity, role membership and grants.
 await sql('GRANT DELETE ON restore_fixture.* TO restore_reader;')
 plan=await previewFullBackup(backup,runtime,progress);const accountChoices=Object.fromEntries(plan.items.filter(item=>item.disposition==='conflict').map(item=>[item.key,item.category==='role'?'replace':'keep']));const restoreAccounts=runtime.restoreBackupAccounts.bind(runtime);let accountInject=true
 runtime.restoreBackupAccounts=async(...args)=>{await restoreAccounts(...args);if(accountInject){accountInject=false;throw Error('Injected after actual role restore')}}
 await assert.rejects(restoreFullDatabase(plan,runtime,accountChoices,store.layout.backups,progress),/Original data\/accounts recovered/);runtime.restoreBackupAccounts=restoreAccounts
 assert.match(await sql('SHOW GRANTS FOR restore_reader'),/DELETE/);assert.match(await sql("SHOW GRANTS FOR 'restore_user'@'localhost'"),/restore_reader/)
 const redis=path.join(store.layout.runtime.redis,'redis.conf');const memcached=path.join(store.layout.runtime.memcached,'memcached.conf');await writeFile(redis,(await readFile(redis,'utf8')).replace('64mb','48mb'));await writeFile(memcached,(await readFile(memcached,'utf8')).replace('-m 32','-m 24'));const redisBefore=await readFile(redis,'utf8');const memcachedBefore=await readFile(memcached,'utf8')
 for (const [server,php] of [['apache','8.4'],['apache','8.5'],['openlitespeed','8.4']]) {const current=await store.getState();await store.saveSettings({...current.settings,selectedWebServer:server,selectedPhpVersion:php});await runtime.applyConfiguration();const response=await health(35180);for(const service of ['redis','memcached'])for(const host of ['localhost','127.0.0.1'])assert.ok(response.includes(`${service}:${host}:ok`));assert.equal(await readFile(redis,'utf8'),redisBefore);assert.equal(await readFile(memcached,'utf8'),memcachedBefore);assert.equal((await sql('SELECT value FROM restore_fixture.identity')).trim(),'pre-failure')}
 const portState=await store.getState();await store.saveSettings({...portState.settings,ports:{...portState.settings.ports,redis:35379,memcached:35211}});await runtime.applyConfiguration();assert.match(await health(35180),/redis:localhost:ok/);assert.match(await health(35180),/memcached:localhost:ok/)
 runtime.dispose();runtime=new DockerRuntimeController(store.layout,()=>store.getState(),undefined,scope);await runtime.start();assert.match(await health(35180),/redis:localhost:ok/);assert.match(await health(35180),/memcached:localhost:ok/)
 plan=await previewFullBackup(backup,runtime,progress);assert.equal(plan.items.filter(item=>item.category==='configuration'&&item.disposition==='conflict').length,2);await restoreFullDatabase(plan,runtime,Object.fromEntries(plan.items.filter(item=>item.disposition==='conflict').map(item=>[item.key,'keep'])),store.layout.backups,progress);assert.match(await readFile(redis,'utf8'),/48mb/)
 const current=await store.getState();await store.saveSettings({...current.settings,optionalServices:{redis:false,memcached:false}});await runtime.applyConfiguration();assert.doesNotMatch(docker(['exec',`${scope}-runtime-1`,'ps','-eo','comm=']),/redis-server|memcached/)
 assert.equal(await readFile(path.join(external,'sentinel'),'utf8'),'untouched');await rm(external,{recursive:true,force:true});complete=true
 console.log('PASS live localhost PHP/cache persistence, disabled daemons; full backup new/identical/conflict/keep/replace/accounts/roles/default-grants/data and actual failure rollback')
} finally {await runtime.resetRuntime(false).catch(error=>console.error(error));runtime.dispose();if(complete)await rm(profile,{recursive:true,force:true});else console.error('Retained diagnostics',profile);assert.deepEqual(inventory(),original)}
