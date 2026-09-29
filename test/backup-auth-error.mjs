// Actual MariaDB private-account SQL failure must never echo a credential.
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
import {VhostraStore} from '../dist-electron/store.js'
import {DockerRuntimeController} from '../dist-electron/runtime.js'
const profile=await mkdtemp(path.join(os.tmpdir(),'vhostra-backup-auth-error-'));const store=new VhostraStore(profile,path.resolve('dist-welcome'));const scope=`vhostra-auth-error-${process.pid}`;const runtime=new DockerRuntimeController(store.layout,()=>store.getState(),undefined,scope)
const inventory=()=>execFileSync('docker',['ps','-a','--format','{{.ID}} {{.Names}} {{.State}}'],{encoding:'utf8'}).trim().split('\n').sort();const before=inventory();let complete=false
try {const state=await store.getState();await store.saveSettings({...state.settings,ports:{...state.settings.ports,mariadb:36306}});await runtime.controlManagedService('mariadb','start');let failure
 try{await runtime.restoreBackupAccounts([{user:'private_failure_fixture',host:'localhost',role:false,create:"CREATE USER 'private_failure_fixture'@'localhost' IDENTIFIED BY 'private-failed-auth-token' UNSUPPORTED CLAUSE",grants:[]}],true)}catch(error){failure=error}
 assert.ok(failure);assert.doesNotMatch(failure.message,/private-failed-auth-token|CREATE USER|IDENTIFIED BY/);assert.match(failure.message,/ERROR/);assert.ok(!(await runtime.backupAccounts()).some(account=>account.user==='private_failure_fixture'));complete=true;console.log('PASS actual private account SQL failure: credential/SQL fragments omitted, no partial identity created')
}finally{await runtime.resetRuntime(false);runtime.dispose();assert.deepEqual(inventory(),before);if(complete)await rm(profile,{recursive:true,force:true});else console.error('Retained private diagnostics',profile)}
