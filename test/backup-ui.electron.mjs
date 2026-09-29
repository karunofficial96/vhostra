// Compiled onboarding/full-manifest renderer → IPC. SQL lifecycle is fixture-only;
// real data/identity/role/grant restoration is exercised by reconciliation-runtime.
import assert from 'node:assert/strict'
import { app, dialog } from 'electron'
import { mkdtempSync } from 'node:fs'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const profile=mkdtempSync(path.join(os.tmpdir(),'vhostra-full-ui-'));app.setPath('userData',profile)
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
app.whenReady().then(async()=>{
 let native;let source;let failed=false;const timer=setTimeout(()=>app.exit(1),90000)
 try {
  const {VhostraStore}=await import('../dist-electron/store.js');const {exportFullBackup}=await import('../dist-electron/backup.js')
  source=await mkdtemp(path.join(os.tmpdir(),'vhostra-full-ui-source-'));const backupStore=new VhostraStore(source);const project=path.join(source,'project');await mkdir(project);await writeFile(path.join(project,'sentinel'),'untouched')
  const sourceState=await backupStore.getState();await backupStore.saveSettings({...sourceState.settings,selectedWebServer:'nginx'});await backupStore.addSite({name:'Full backup Site',url:'http://full-backup.test',documentRoot:project})
  let account={user:'ui_reader',host:'localhost',role:false,create:"CREATE USER 'ui_reader'@'localhost' IDENTIFIED BY PASSWORD 'private-ui-hash'",grants:["GRANT SELECT ON ui_data.* TO 'ui_reader'@'localhost'"]};const backupAccount=structuredClone(account);let data='original rows';let writes=0
  const fixture={databaseBackupStatus:async()=> 'running',backupDatabaseMetadata:async()=>({version:'11.8.6',plugins:['mysql_native_password']}),listDatabases:async()=>['ui_data'],backupAccounts:async()=>[structuredClone(account)],backupCacheState:async()=>({redis:null,memcached:null}),exportDatabase:async(_name,file)=>writeFile(file,data)}
  const backup=path.join(source,'full.json');await exportFullBackup(backupStore,fixture,backup,()=>{});account.grants=["GRANT INSERT ON ui_data.* TO 'ui_reader'@'localhost'"]
  await import('../dist-electron/main.js');await pause(700);native=(await import('../dist-electron/main.js')).applicationSession();const {window,runtime,hosts}=native
  Object.assign(runtime,fixture,{restoreBackupAccounts:async selected=>{assert.equal(selected.length,1);account=structuredClone(selected[0]);writes++},reapplyBackupGrants:async()=>{},restoreBackupCacheState:async()=>{},refresh:async()=>runtime.set({state:'stopped',services:[],message:'Full-backup UI fixture'}),listManagedServices:async()=>[]})
  const hostsPath=path.join(profile,'hosts');await writeFile(hostsPath,'127.0.0.1 localhost\n');Object.defineProperty(hosts,'hostsPath',{value:hostsPath});hosts.platform='linux';hosts.execute=async(_command,args)=>promisify(execFile)(args[0],args.slice(1))
  const evaluate=code=>window.webContents.executeJavaScript(code);const waitFor=async code=>{const end=Date.now()+30000;while(!await evaluate(code)){if(Date.now()>end)throw Error(code);await pause(50)}};const click=label=>evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!b)throw Error('Missing '+${JSON.stringify(label)});b.click()})()`)
  await waitFor('document.body.textContent.includes("Welcome to Vhostra")');dialog.showOpenDialog=async()=>({canceled:false,filePaths:[backup]});await click('Import existing Vhostra backup');await waitFor('document.body.textContent.includes("ui_reader@localhost")')
  assert.doesNotMatch(await evaluate('document.body.textContent'),/private-ui-hash|IDENTIFIED/);assert.equal(await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Restore supported configuration").disabled'),true)
  await click('Compare database data');await waitFor('document.body.textContent.includes("Identical — skip")')
  await evaluate(`(()=>{const section=[...document.querySelectorAll('section')].find(s=>s.querySelector('h3')?.textContent.includes('ui_reader@localhost'));const select=section.querySelector('select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'replace');select.dispatchEvent(new Event('change',{bubbles:true}));const server=[...document.querySelectorAll('label')].find(l=>l.textContent.startsWith('Restore for web server')).querySelector('select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(server,'apache');server.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await writeFile('/private/tmp/vhostra-full-backup-review.png',(await window.webContents.capturePage()).toPNG());await click('Restore supported configuration');await waitFor('document.body.textContent.includes("Ready to set up")');assert.equal(writes,1);assert.deepEqual(account,backupAccount);assert.equal(data,'original rows')
  const state=await evaluate('window.vhostra.getState()');assert.equal(state.settings.selectedWebServer,'apache');assert.equal(state.sites.filter(s=>!s.builtIn).length,1);assert.equal(state.sites.find(s=>!s.builtIn).documentRoot,project);assert.match(await readFile(hostsPath,'utf8'),/full-backup.test/)
  runtime.start=async()=>{await runtime.generate(await runtime.getState());runtime.set({state:'running',services:['runtime'],message:'Fixture native configuration generated'})};await click('Set Up Vhostra');await waitFor('document.body.textContent.includes("Thank you for setting up Vhostra")');assert.equal((await evaluate('window.vhostra.getOnboarding()')).preferences.completed,false)
  await click('Start using Vhostra');await waitFor('document.body.textContent.includes("Dashboard")');assert.equal(await readFile(path.join(project,'sentinel'),'utf8'),'untouched');assert.match(await readFile(path.join(runtime.layout.runtime.apache,'vhostra.conf'),'utf8'),/full-backup.test/)
  console.log('PASS full-backup native onboarding/IPC: safe manifest review, conflict gating, explicit equality, account replacement, nginx→apache selection/generated configuration, real TEMP Hosts and final setup gate; SQL fixture writes:',writes)
 }catch(error){failed=true;console.error(error);if(native?.window)console.error(await native.window.webContents.executeJavaScript('document.body.textContent'))}
 finally{clearTimeout(timer);await native?.runtime.pauseBackgroundWork();native?.runtime.dispose();native?.window.destroy();await (await import('../dist-electron/logs.js')).drainApplicationLogs();try{if(!failed)for(const folder of [profile,source].filter(Boolean))await rm(folder,{recursive:true,force:true,maxRetries:5,retryDelay:150});else console.error('Retained full UI diagnostics',profile,source)}finally{app.exit(failed?1:0)}}
})
