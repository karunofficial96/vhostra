import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm, mkdir, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { VhostraStore } from '../dist-electron/store.js'
import { DockerRuntimeController } from '../dist-electron/runtime.js'
const fixture = async task => {
 const profile=await mkdtemp(path.join(os.tmpdir(),'vhostra-db-contract-')); const store=new VhostraStore(profile,path.resolve('dist-welcome')); const state=await store.getState(); const runtime=new DockerRuntimeController(store.layout,()=>store.getState(),undefined,'vhostra-db-contract')
 try { await task({profile,store,state,runtime}) } finally { runtime.dispose();await rm(profile,{recursive:true,force:true}) }
}
test('database data/config/secrets belong to independent Compose lifecycle and runtime has only local proxies',()=>fixture(async({store,state,runtime})=>{
 await runtime.generate(state)
 const web=await readFile(path.join(store.layout.root,'runtime','compose.yml'),'utf8');const db=await readFile(path.join(store.layout.runtime.mariaDb,'compose.yml'),'utf8')
 assert.doesNotMatch(web,/\/var\/lib\/mysql|mariadb\.conf\.d|:3306/);assert.match(web,/external: true/)
 assert.match(db,/vhostra-db-contract-mariadb/);assert.match(db,/internal: true/);assert.match(db,/aliases: \[vhostra-mariadb\]/)
 assert.ok(db.includes(`${store.layout.persistentData.mariaDb}:/var/lib/mysql`));assert.ok(db.includes(`${store.layout.runtime.mariaDb}/vhostra.cnf:`))
 assert.match(db,/127\.0\.0\.1:3306:3306/);assert.doesNotMatch(db,/MARIADB_ROOT_PASSWORD=/)
 assert.doesNotMatch(await readFile(runtime.environmentFile,'utf8'),/MARIADB_ROOT_PASSWORD/)
 const supervisor=await readFile('runtime-image/supervisor.conf','utf8'); assert.doesNotMatch(supervisor,/\[program:mariadb\]/);assert.match(supervisor,/UNIX-LISTEN:.*mysqld\.sock/);assert.match(supervisor,/TCP4-LISTEN:3306,bind=127\.0\.0\.1/)
 const ini=await readFile(path.join(store.layout.runtime.php,'vhostra.ini'),'utf8');assert.match(ini,/mysqli.default_socket=\/run\/mysqld\/mysqld.sock/);assert.match(ini,/pdo_mysql.default_socket=\/run\/mysqld\/mysqld.sock/)
}))
test('server/PHP generation preserves database and cache configuration bytes and extension intent',()=>fixture(async({store,state,runtime})=>{
 state.settings.php.extensions=['intl','apcu'];state.settings.optionalServices.redis=true;state.settings.optionalServices.memcached=true; await store.saveSettings(state.settings);await runtime.generate(state)
 const files=[path.join(store.layout.runtime.mariaDb,'secrets.env'),path.join(store.layout.runtime.mariaDb,'vhostra.cnf'),path.join(store.layout.runtime.redis,'redis.conf'),path.join(store.layout.runtime.memcached,'memcached.conf')]
 for(const file of files.slice(1)) await writeFile(file,(await readFile(file,'utf8'))+'\n# user local configuration\n')
 const bytes=await Promise.all(files.map(file=>readFile(file,'utf8')));const database=await readFile(path.join(store.layout.runtime.mariaDb,'compose.yml'),'utf8')
 for(const [server,php] of [['nginx','8.4'],['apache','8.5'],['openlitespeed','8.3']]) { state.settings.selectedWebServer=server;state.settings.selectedPhpVersion=php;await runtime.generate(state); assert.deepEqual(await Promise.all(files.map(file=>readFile(file,'utf8'))),bytes);assert.equal(await readFile(path.join(store.layout.runtime.mariaDb,'compose.yml'),'utf8'),database);assert.deepEqual(state.settings.php.extensions,['intl','apcu']) }
}))
test('existing datadir chooses its recorded series and refuses unknown series without touching data',()=>fixture(async({store,state,runtime})=>{
 await mkdir(path.join(store.layout.persistentData.mariaDb,'mysql'));await writeFile(path.join(store.layout.persistentData.mariaDb,'mariadb_upgrade_info'),'11.8.6-MariaDB')
 await runtime.prepareDatabase(state);assert.match(await readFile(path.join(store.layout.runtime.mariaDb,'compose.yml'),'utf8'),/MARIADB_SERIES: "11\.8"/)
 await writeFile(path.join(store.layout.persistentData.mariaDb,'mariadb_upgrade_info'),'99.0.0');await assert.rejects(runtime.prepareDatabase(state),/will not implicitly upgrade or reset/);assert.equal(await readFile(path.join(store.layout.persistentData.mariaDb,'mariadb_upgrade_info'),'utf8'),'99.0.0')
}))
for(const keep of [true,false])test(`reset ${keep?'preserves':'removes'} database credentials/config/data, preserves external roots`,()=>fixture(async({profile,store,state,runtime})=>{
 const external=await mkdtemp(path.join(os.tmpdir(),'vhostra-db-external-'))
 try {await writeFile(path.join(external,'sentinel'),'external');await store.addSite({name:'local',url:'http://local.test',documentRoot:external});await runtime.generate(await store.getState());await writeFile(path.join(store.layout.persistentData.mariaDb,'identity'),'data');const secrets=await readFile(path.join(store.layout.runtime.mariaDb,'secrets.env'),'utf8');await store.resetConfiguration(keep)
 if(keep){assert.equal(await readFile(path.join(store.layout.persistentData.mariaDb,'identity'),'utf8'),'data');assert.equal(await readFile(path.join(store.layout.runtime.mariaDb,'secrets.env'),'utf8'),secrets)}else{await assert.rejects(stat(path.join(store.layout.persistentData.mariaDb,'identity')),/ENOENT/);await assert.rejects(stat(path.join(store.layout.runtime.mariaDb,'secrets.env')),/ENOENT/)}
 assert.equal(await readFile(path.join(external,'sentinel'),'utf8'),'external');assert.equal((await new VhostraStore(profile).getState()).sites.length,keep?2:1)
 }finally{await rm(external,{recursive:true,force:true})}
}))
test('independent database status distinguishes actual healthy/starting/unhealthy/failed/stopped',()=>fixture(async({runtime,state})=>{
 let container={State:{Running:true,Status:'running',Health:{Status:'healthy'}}};runtime.databaseContainerIds=async()=>['test'];runtime.docker=async()=>JSON.stringify([container]);runtime.snapshot.state='stopped'
 for(const [health,expected] of [['healthy','running'],['starting','starting'],['unhealthy','unhealthy']]){container.State.Health.Status=health;assert.equal((await runtime.listManagedServices()).find(row=>row.id==='mariadb').state,expected);assert.equal((await runtime.listManagedServices()).find(row=>row.id==='web').state,'stopped')}
 container.State={Running:false,Status:'exited',ExitCode:1};assert.equal(await runtime.databaseStatus(),'failed');container.State.ExitCode=0;assert.equal(await runtime.databaseStatus(),'stopped')
}))
test('local screenshot cache verifies Site identity and preserves external files on removal',()=>fixture(async({store})=>{
 const external=await mkdtemp(path.join(os.tmpdir(),'vhostra-preview-external-'))
 try { await writeFile(path.join(external,'sentinel'),'external');const state=await store.addSite({name:'preview',url:'http://preview.test',documentRoot:external});const site=state.sites.find(site=>!site.builtIn);await assert.rejects(store.saveScreenshot(site.id,'http://changed.test',Buffer.from('image'),'manual'),/changed/);await store.saveScreenshot(site.id,site.url,Buffer.from('image'),'manual');assert.equal((await store.readScreenshot(site.id)).data.toString(),'image');await store.removeSite(site.id);await assert.rejects(stat(path.join(store.layout.screenshots,`${site.id}.jpg`)),/ENOENT/);assert.equal(await readFile(path.join(external,'sentinel'),'utf8'),'external') }finally{await rm(external,{recursive:true,force:true})}
}))
test('persistent log reads redact backend credentials without initializing runtime state',()=>fixture(async({store,runtime})=>{
 await writeFile(path.join(store.layout.runtime.mariaDb,'secrets.env'),'MARIADB_ROOT_PASSWORD=private-generated-password\nVHOSTRA_PMA_PASSWORD=private-pma-password\n');
 const result=await runtime.redactLocalLog('root: private-generated-password; pma: private-pma-password; password=imported-private');
 assert.doesNotMatch(result,/private-generated-password|private-pma-password|imported-private/);
 assert.match(result,/\*{8}/);
 await assert.rejects(stat(runtime.composeFile),/ENOENT/);
}))
test('backup account export preserves single-column and historical two-column SHOW CREATE USER authentication',()=>fixture(async({runtime})=>{
 const statement="CREATE USER 'fixture_user'@'localhost' IDENTIFIED VIA unix_socket OR mysql_native_password USING '*fixture-authentication'";
 for(const output of [statement,`fixture_user@localhost\t${statement}`]){
  runtime.databaseCompose=async args=>{const sql=args.at(-1);if(sql.includes('SELECT HEX(User)'))return `${Buffer.from('fixture_user').toString('hex')}\t${Buffer.from('localhost').toString('hex')}\tN\n`;if(sql.startsWith('SHOW CREATE USER'))return output+'\n';if(sql.startsWith('SHOW GRANTS'))return "GRANT SELECT ON app.* TO 'fixture_user'@'localhost'\n";throw Error('Unexpected backup query')}
  const accounts=await runtime.backupAccounts();assert.ok(accounts[0].create===statement,'Authentication plugin or clause was omitted')
 }
 runtime.databaseCompose=async args=>args.at(-1).includes('SELECT HEX(User)')?`${Buffer.from('fixture_user').toString('hex')}\t${Buffer.from('localhost').toString('hex')}\tN\n`:''
 await assert.rejects(runtime.backupAccounts(),/authentication configuration/)
}))
