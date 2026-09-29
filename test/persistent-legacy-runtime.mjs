// One isolated historical datadir handover; run after other Docker suites.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp,writeFile,readFile,rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { VhostraStore } from '../dist-electron/store.js'
import { DockerRuntimeController } from '../dist-electron/runtime.js'
const profile=await mkdtemp(path.join(os.tmpdir(),'vhostra-legacy-db-'));const destination=await mkdtemp(path.join(os.tmpdir(),'vhostra-legacy-db-dest-'));const scope=`vhostra-legacy-${process.pid}`;const store=new VhostraStore(profile,path.resolve('dist-welcome'));let runtime=new DockerRuntimeController(store.layout,()=>store.getState(),undefined,scope);let succeeded=false
const docker=(args,input)=>execFileSync('docker',args,{encoding:'utf8',input,timeout:120000});const sql=statement=>runtime.databaseCompose(['exec','-T','mariadb','mariadb','-uroot','-N','-e',statement]);const original=docker(['ps','-a','--format','{{.ID}} {{.Names}} {{.State}}']).split('\n').filter(Boolean).sort()
try{
 const {settings}=await store.getState();settings.ports.mariadb=33306;await store.saveSettings(settings)
 const runtimeRoot=path.dirname(store.layout.runtime.apache)
 // Old image is read-only; this container has only the new test datadir mounted.
 docker(['run','--detach','--name',`${scope}-runtime-1`,'--label','com.vhostra.managed=true','--label',`com.docker.compose.project=${scope}`,'--label','com.docker.compose.service=runtime','--label',`com.docker.compose.project.working_dir=${runtimeRoot}`,'--mount',`type=bind,source=${store.layout.persistentData.mariaDb},target=/var/lib/mysql`,'--entrypoint','/bin/sh','vhostra-runtime:build-334d3e32df22f0d7aeb83c4d','-lc','mkdir -p /run/mysqld; chown mysql:mysql /run/mysqld; mariadb-install-db --user=mysql --datadir=/var/lib/mysql >/dev/null; exec mariadbd --user=mysql --datadir=/var/lib/mysql'])
 for(let i=0;i<40;i++){try{docker(['exec',`${scope}-runtime-1`,'mariadb','-uroot','-e','SELECT 1']);break}catch{await new Promise(resolve=>setTimeout(resolve,1000))}}
 docker(['exec','-i',`${scope}-runtime-1`,'mariadb','-uroot'],"CREATE DATABASE legacy_probe; CREATE TABLE legacy_probe.identity(id INT); INSERT INTO legacy_probe.identity VALUES(42); CREATE USER 'legacy_local'@'localhost' IDENTIFIED BY 'isolated-legacy-secret'; CREATE ROLE legacy_reader; GRANT SELECT ON legacy_probe.* TO legacy_reader; GRANT legacy_reader TO 'legacy_local'@'localhost'; SET DEFAULT ROLE legacy_reader FOR 'legacy_local'@'localhost';")
 const before=docker(['exec',`${scope}-runtime-1`,'mariadb','-uroot','-N','-e',"SELECT VERSION(); SHOW GRANTS FOR 'legacy_local'@'localhost'; SHOW GRANTS FOR legacy_reader; SELECT id FROM legacy_probe.identity;"])
 await writeFile(path.join(runtimeRoot,'.env'),'MARIADB_ROOT_PASSWORD=historical-local-secret\nVHOSTRA_PMA_PASSWORD=historical-pma-secret\nVHOSTRA_PMA_BLOWFISH_SECRET=historical-blowfish-secret\n')
 await runtime.controlManagedService('mariadb','start')
 assert.equal(docker(['inspect',`${scope}-runtime-1`,'--format','{{.State.Running}}']).trim(),'false')
 const after=await sql("SHOW GRANTS FOR 'legacy_local'@'localhost'; SHOW GRANTS FOR legacy_reader; SELECT id FROM legacy_probe.identity;");assert.equal(after,before.split('\n').slice(1).join('\n'))
 assert.match(await readFile(path.join(store.layout.runtime.mariaDb,'secrets.env'),'utf8'),/historical-pma-secret/)
 // Actual host TCP gateway retains localhost-only role-based authentication.
 docker(['exec','-i',`${scope}-mariadb`,'sh','-c','umask 077; cat > /run/fixture-client.cnf'],"[client]\nuser=legacy_local\npassword=isolated-legacy-secret\nhost=127.0.0.1\nport=3306\n")
 assert.equal(docker(['exec',`${scope}-mariadb`,'mariadb','--defaults-extra-file=/run/fixture-client.cnf','-N','-e','SELECT id FROM legacy_probe.identity']),'42\n')
  assert.equal(await sql('SELECT id FROM legacy_probe.identity'),'42\n')
  // Migration drains both independent containers before verified host copy.
  await runtime.resetRuntime(false);await runtime.pauseBackgroundWork();runtime.dispose()
  await store.migrateConfiguration(destination,async()=>{runtime=new DockerRuntimeController(store.layout,()=>store.getState(),undefined,scope);await runtime.controlManagedService('mariadb','start')})
  assert.equal(await sql('SELECT id FROM legacy_probe.identity'),'42\n');assert.match(await sql("SHOW GRANTS FOR 'legacy_local'@'localhost'"),/legacy_reader/)
  console.log('PASS legacy 11.8 datadir handover, localhost user/role/grants/data and independently running DB configuration migration');succeeded=true
 }finally{await runtime.resetRuntime(false).catch(error=>console.error(error.message));runtime.dispose();if(succeeded){await rm(profile,{recursive:true,force:true});await rm(destination,{recursive:true,force:true})}else console.error(`Retained legacy fixture ${profile}`);assert.deepEqual(docker(['ps','-a','--format','{{.ID}} {{.Names}} {{.State}}']).split('\n').filter(Boolean).sort(),original)}
