import assert from 'node:assert/strict'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {VhostraStore} from '../dist-electron/store.js'
import {DockerRuntimeController} from '../dist-electron/runtime.js'
// Reproduces the legacy SQL workflow deliberately; production no longer uses it.
const profile=await mkdtemp(path.join(os.tmpdir(),'vhostra-db-reproduce-'))
const scope=`vhostra-db-reproduce-${process.pid}`
const store=new VhostraStore(profile,path.resolve('dist-welcome'))
const runtime=new DockerRuntimeController(store.layout,()=>store.getState(),undefined,scope)
const sql=s=>runtime.databaseCompose(['exec','-T','mariadb','mariadb','-uroot','-N','-e',s])
try {
 const {settings}=await store.getState();settings.selectedWebServer='nginx';settings.selectedPhpVersion='8.4';settings.ports={http:33180,https:33443,phpMyAdmin:33181,mariadb:33306,redis:33379,memcached:33211};await store.saveSettings(settings)
 await runtime.controlManagedService('mariadb','start')
 console.log('Initial nonsecret identities/plugins:',await sql('SELECT User,Host,plugin FROM mysql.user'))
 await sql("CREATE DATABASE repro_db; CREATE USER 'repro_user'@'%' IDENTIFIED BY 'reproduction-valid-password'; GRANT ALL ON repro_db.* TO 'repro_user'@'%';")
 await sql("CREATE USER 'repro_user'@'localhost' IDENTIFIED BY 'different-existing-password'; GRANT ALL ON repro_db.* TO 'repro_user'@'localhost';")
 await writeFile(path.join(store.layout.sites,'localhost/public/probe.php'),`<?php mysqli_report(MYSQLI_REPORT_OFF); $db=@new mysqli('localhost','repro_user','reproduction-valid-password','repro_db'); echo $db->connect_errno ? 'denied:'.$db->connect_errno : $db->query('SELECT CURRENT_USER()')->fetch_row()[0];`)
 await runtime.start()
 const response=await fetch('http://localhost:33180/probe.php');const body=await response.text();assert.match(body,/denied:1045/);console.log('REPRODUCED PHP localhost access denied:1045 with valid wildcard password and shadowing local account')
 await assert.rejects(sql("CREATE DATABASE partial_db; CREATE USER 'repro_user'@'%' IDENTIFIED BY 'reproduction-valid-password';"),/1396/)
 assert.ok((await runtime.listDatabases()).includes('partial_db'));console.log('REPRODUCED duplicate ERROR 1396 leaves database behind')
 console.log('Account identity at gateway:', await sql("SELECT User,Host,plugin FROM mysql.user WHERE User='repro_user'"))
} finally {await runtime.resetRuntime(false);await runtime.pauseBackgroundWork();runtime.dispose();await rm(profile,{recursive:true,force:true})}
