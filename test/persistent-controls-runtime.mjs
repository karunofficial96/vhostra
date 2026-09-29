// Small sequential acceptance of CLI reset, safe backups, logs and resources.
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,readFile,rm,stat} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
import {VhostraStore} from '../dist-electron/store.js'
import {DockerRuntimeController} from '../dist-electron/runtime.js'
import {localStorageUsage} from '../dist-electron/resources.js'
const profile=await mkdtemp(path.join(os.tmpdir(),'vhostra-controls-db-'));const scope=`vhostra-controls-${process.pid}`;const store=new VhostraStore(profile,path.resolve('dist-welcome'));let runtime=new DockerRuntimeController(store.layout,()=>store.getState(),undefined,scope);let complete=false
const docker=args=>execFileSync('docker',args,{encoding:'utf8',timeout:120000});const original=docker(['ps','-a','--format','{{.ID}} {{.Names}} {{.State}}']).split('\n').filter(Boolean).sort()
const environment={...process.env,VHOSTRA_USER_DATA:profile,VHOSTRA_RUNTIME_PROJECT:scope};const sql=statement=>runtime.databaseCompose(['exec','-T','mariadb','mariadb','-uroot','-N','-e',statement]);const reset=choice=>execFileSync('python3',['test/cli-reset-pty.py',process.execPath,'scripts/vhostra.mjs','reset'],{env:{...environment,VHOSTRA_TEST_RESET_CHOICE:choice},encoding:'utf8',timeout:150000})
try{
 const {settings}=await store.getState();settings.selectedWebServer='nginx';settings.selectedPhpVersion='8.4';settings.php.extensions=['intl','apcu'];settings.ports={http:34180,https:34443,phpMyAdmin:34181,mariadb:34306,redis:34379,memcached:34211};await store.saveSettings(settings);await runtime.start()
 const processes=docker(['exec',`${scope}-runtime-1`,'ps','-eo','comm=']);assert.doesNotMatch(processes,/mariadbd|redis-server|memcached/);assert.match(processes,/socat/)
 await runtime.createDatabase({name:'control_probe',charset:'utf8mb4',username:'control_user',password:'isolated-control-password'});await sql('CREATE TABLE control_probe.identity(id INT);INSERT INTO control_probe.identity VALUES(42);')
 const destination=path.join(profile,'backup.sql');await runtime.exportDatabase('control_probe',destination);const good=await readFile(destination,'utf8');assert.match(good,/42/)
 await assert.rejects(runtime.exportDatabase('missing_database',destination));assert.equal(await readFile(destination,'utf8'),good)
 const bad=path.join(profile,'private-invalid.sql');await writeFile(bad,"CREATE USER 'foo'@'%' IDENTIFIED BY 'do-not-expose-secret' BAD SYNTAX;");let error='';try{await runtime.importDatabase('control_probe',bad)}catch(failure){error=failure.message}assert.ok(error);assert.doesNotMatch(error,/do-not-expose-secret/);await runtime.refresh()
 const dbId=docker(['inspect',`${scope}-mariadb`,'--format','{{.Id}}']);const started=docker(['inspect',`${scope}-mariadb`,'--format','{{.State.StartedAt}}'])
 await runtime.controlManagedService('mariadb','stop');const stoppedState=docker(['inspect',`${scope}-mariadb`,'--format','{{.State.StartedAt}} {{.State.FinishedAt}}'])
 const current=await store.getState();await store.saveSettings({...current.settings,selectedWebServer:'apache'});await runtime.applyConfiguration();assert.equal((await runtime.listManagedServices()).find(row=>row.id==='mariadb').state,'stopped');assert.equal(docker(['inspect',`${scope}-mariadb`,'--format','{{.State.StartedAt}} {{.State.FinishedAt}}']),stoppedState)
 await runtime.controlManagedService('mariadb','start');assert.equal(docker(['inspect',`${scope}-mariadb`,'--format','{{.Id}}']),dbId);assert.equal(await sql('SELECT id FROM control_probe.identity'),'42\n')
 await new Promise(resolve=>setTimeout(resolve,15000));const metrics=await runtime.resourceUsage();assert.equal(metrics.length,2);assert.ok(metrics.some(row=>row.Name===`${scope}-mariadb`));console.log('MEASUREMENT',JSON.stringify({metrics,storage:await localStorageUsage(store.layout,[]),dockerStorage:await runtime.resourceStorage(),images:JSON.parse(docker(['inspect',`${scope}-runtime-1`,`${scope}-mariadb`])).map(row=>({name:row.Name,image:row.Image,bytes:Number(docker(['image','inspect',row.Image,'--format','{{.Size}}']))}))}))
 assert.match(reset('keep'),/databases\/users\/roles\/grants preserved/);runtime.dispose();runtime=new DockerRuntimeController(store.layout,()=>store.getState(),undefined,scope);assert.equal(await sql('SELECT id FROM control_probe.identity'),'42\n');assert.equal((await store.getState()).settings.ports.mariadb,34306)
 assert.match(reset('remove'),/databases\/users\/roles\/grants removed/);runtime.dispose();runtime=new DockerRuntimeController(store.layout,()=>store.getState(),undefined,scope);const settingsAfter=(await store.getState()).settings;await store.saveSettings({...settingsAfter,ports:settings.ports});await runtime.controlManagedService('mariadb','start');assert.ok(!(await runtime.listDatabases()).includes('control_probe'))
 console.log('PASS actual CLI Keep/Remove/final confirmations, stopped DB switch preservation, disabled cache daemon absence, safe streaming backup/failure secrecy and separate resources');complete=true
}finally{await runtime.resetRuntime(false).catch(error=>console.error(error.message));runtime.dispose();if(complete)await rm(profile,{recursive:true,force:true});else console.error(`Retained controls fixture ${profile}`);assert.deepEqual(docker(['ps','-a','--format','{{.ID}} {{.Names}} {{.State}}']).split('\n').filter(Boolean).sort(),original)}
