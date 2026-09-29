import assert from 'node:assert/strict'
import { app } from 'electron'
import { mkdtempSync } from 'node:fs'
import { writeFile,rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
const profile=mkdtempSync(path.join(os.tmpdir(),'vhostra-database-ui-'));app.setPath('userData',profile)
const scope=`vhostra-database-ui-${process.pid}`
const docker=args=>execFileSync('docker',args,{encoding:'utf8',timeout:120000})
const inventory=()=>docker(['ps','-a','--format','{{.ID}} {{.Names}} {{.State}}']).split('\n').filter(row=>row&&!row.includes(scope)).sort()
const before=inventory();const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const timeout=setTimeout(()=>{console.error('Database UI acceptance timeout');app.exit(1)},240000)
app.whenReady().then(async()=>{
 let runtime,window;let failed=false
 try {
  const {VhostraStore}=await import('../dist-electron/store.js');const store=new VhostraStore(profile,path.resolve('dist-welcome'));const {settings}=await store.getState()
  settings.selectedWebServer='nginx';settings.selectedPhpVersion='8.4';settings.php.extensions=['apcu','intl'];settings.php.opcacheEnabled=false;settings.optionalServices={redis:true,memcached:true};settings.startup.startServicesOnLaunch=false;settings.ports={http:34180,https:34443,phpMyAdmin:34181,mariadb:34306,redis:34379,memcached:34211};await store.saveSettings(settings)
  await store.saveOnboarding({...await store.getOnboarding(),completed:true,themeSaved:true,theme:'light'})
  const {applicationSession}=await import('../dist-electron/main.js');await pause(500);const native=applicationSession();runtime=native.runtime;window=native.window;runtime.scope=scope
  window.webContents.setBackgroundThrottling(false)
  const hosts=path.join(profile,'fixture-hosts');await writeFile(hosts,'127.0.0.1 localhost\n');Object.defineProperty(native.hosts,'hostsPath',{value:hosts})
  window.webContents.on('console-message',event=>{if(event.level==='error')console.error('Renderer diagnostic:',event.message)})
  const evaluate=code=>window.webContents.executeJavaScript(code)
  const waitFor=async expression=>{const end=Date.now()+30000;while(!await evaluate(expression)){if(Date.now()>end)throw Error('Timed out waiting for UI condition');await pause(100)}}
  const click=async label=>{await waitFor(`[...document.querySelectorAll('button')].some(button=>button.textContent.trim()===${JSON.stringify(label)} && !button.disabled)`);return evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(button=>button.textContent.trim()===${JSON.stringify(label)});if(!button)throw Error('Missing button');button.click()})()`)}
  const ready=label=>waitFor(`(()=>{const node=document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify(label))}+']');return node && !node.disabled && !node.closest('fieldset')?.disabled})()`)
  const fill=async(label,value)=>{await ready(label);return evaluate(`(()=>{const input=document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify(label))}+']');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}))})()`)}
  const select=async(label,value)=>{await ready(label);return evaluate(`(()=>{const input=document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify(label))}+']');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('change',{bubbles:true}))})()`)}
  await waitFor('document.body.textContent.includes("Dashboard")');await runtime.start();await click('Database');await waitFor('!!document.querySelector("[aria-label=\\"Database Name\\"]")')
  await fill('Database Name','ui_database');await fill('Username','karu_dbuser');await fill('Database Password','isolated-ui-database-password');await click('Create Database')
  await waitFor('!!document.querySelector("[data-database=ui_database]")');assert.ok((await runtime.listDatabases()).includes('ui_database'));assert.match(await evaluate('document.body.textContent'),/Database created successfully/)
  assert.equal(await evaluate('document.querySelector("[aria-label=\\"Database Password\\"]").value'),'')
  await waitFor('document.querySelector("[aria-label=\\"Database User\\"]").textContent.includes("karu_dbuser @ localhost")')
  const duplicateStatements=[];const accountSql=runtime.accountSql.bind(runtime);runtime.accountSql=async statement=>{duplicateStatements.push(statement);return accountSql(statement)};
  await fill('Database Name','ui_duplicate');await fill('Database Password','isolated-ui-database-password');await click('Create Database');await waitFor('document.querySelector("[role=alert]")?.textContent.includes("already exists")');assert.ok(!(await runtime.listDatabases()).includes('ui_duplicate'))
  assert.equal(await evaluate(`document.querySelector('[aria-label="Database Name"]').value`),'ui_duplicate');assert.match(await evaluate('document.querySelector("[role=alert]").textContent'),/Database user already exists/);assert.doesNotMatch(await evaluate('document.querySelector("[role=alert]").textContent'),/1396/);
  assert.ok(!duplicateStatements.some(sql=>/^\s*(?:CREATE USER|CREATE DATABASE|GRANT|ALTER USER)\b/i.test(sql)));runtime.accountSql=accountSql;
  console.log('STEP duplicate error selection');assert.equal(await evaluate('getComputedStyle(document.querySelector("[role=alert] dd")).userSelect'),'text');await click('Select Existing User')
  console.log('STEP existing-account selector');assert.equal(await evaluate(`document.querySelector('[aria-label="Database Name"]').value`),'ui_duplicate');await fill('Database Password','isolated-ui-database-password');await click('Create Database');await waitFor('!!document.querySelector("[data-database=ui_duplicate]")')
  const sql=s=>runtime.databaseCompose(['exec','-T','mariadb','mariadb','-uroot','-N','-e',s])
  assert.equal((await sql("SELECT COUNT(*) FROM mysql.user WHERE User='karu_dbuser' AND Host='localhost'")).trim(),'1')
  await fill('Database Name','ui_wrong_password');await fill('Database Password','wrong-password');await click('Create Database');await waitFor('document.querySelector("[role=alert]")?.textContent.includes("could not connect")')
  assert.equal(await evaluate('document.querySelector("[role=alert] details").open'),false);assert.doesNotMatch(await evaluate('document.querySelector("[role=alert]").textContent'),/wrong-password|isolated-ui-database-password/)
  await pause(6500);assert.ok(await evaluate('!!document.querySelector("[role=alert]")'));assert.ok(!await evaluate('document.body.textContent.includes("Database created successfully.")'))
  await evaluate('document.querySelector("[role=alert] summary").click()');await pause(200);await writeFile('/private/tmp/vhostra-database-error-ui.png',(await window.webContents.capturePage()).toPNG())
  await click('Dismiss');await pause(200);await writeFile('/private/tmp/vhostra-database-create-ui.png',(await window.webContents.capturePage()).toPNG())
  const audit=async screen=>{
   const problems=await evaluate(`(()=>{const forbidden=[...document.querySelectorAll('h1,h2,h3,nav button,summary,dt,label,.ui-label')].filter(node=>getComputedStyle(node).userSelect!=='none');const inputs=[...document.querySelectorAll('input:not([type=checkbox]),textarea')].filter(node=>getComputedStyle(node).userSelect!=='text');return {forbidden:forbidden.map(node=>node.tagName+':'+node.textContent.slice(0,60)),inputs:inputs.length}})()`)
   assert.deepEqual(await evaluate(`(()=>{const nodes=[...document.querySelectorAll('.selectable,.selectable-status,.selectable-value,.selectable-path,.selectable-message,.selectable-diagnostic,.runtime-line')];return nodes.filter(node=>getComputedStyle(node).userSelect!=='text').map(node=>node.textContent.slice(0,40))})()`),[],screen+' copyable values');
   assert.deepEqual(problems,{forbidden:[],inputs:0},screen);console.log(`PASS ${screen}: heading/label/control selection and editable input semantics`)
  }
  await audit('Databases');await click('Dashboard');await pause(500);assert.deepEqual(await evaluate(`(()=>{const card=[...document.querySelectorAll('article')].find(node=>node.textContent.includes('Selected web server'));return [...card.querySelectorAll('p')].slice(1).map(node=>getComputedStyle(node).userSelect)})()`),['none','text']);await click('Services');await pause(500);assert.deepEqual(await evaluate(`(()=>{const card=document.querySelector('article');return [getComputedStyle(card.querySelector('p')).userSelect,getComputedStyle(card.querySelector('.selectable-status')).userSelect]})()`),['none','text']);for(const screen of ['Dashboard','Sites','Services','Resources','Logs','Settings','Help & documentation']){await click(screen);await pause(500);await audit(screen)}
  await click('Sites');await pause(500);assert.deepEqual(await evaluate(`(()=>{const labels=[...document.querySelectorAll('dt')].filter(node=>['Server Name','Server Alias','Access Log','Error Log'].includes(node.textContent));return labels.map(label=>[getComputedStyle(label).userSelect,getComputedStyle(label.nextElementSibling).userSelect])})()`),[['none','text'],['none','text'],['none','text'],['none','text']]);
  await click('Settings');await click('Reset Vhostra…');await audit('Reset dialog');await click('Cancel')
  await click('Quit');await audit('Quit dialog');await click('Cancel')
  // Input retains native keyboard selection and replacement (no selection listeners).
  await click('Help & documentation');window.show();window.focus();window.webContents.focus();await evaluate('document.querySelector("input").focus()');await window.webContents.insertText('copyable help input');await pause(100);window.webContents.selectAll();await pause(100)
  assert.equal(await evaluate('document.querySelector("input").selectionEnd-document.querySelector("input").selectionStart'),19)
  await window.webContents.insertText('replacement');await pause(100);assert.equal(await evaluate('document.querySelector("input").value'),'replacement')
  window.webContents.undo();await pause(100);assert.equal(await evaluate('document.querySelector("input").value'),'copyable help input')
  window.webContents.redo();await pause(100);assert.equal(await evaluate('document.querySelector("input").value'),'replacement')
  // Read onboarding in the same isolated profile; runtime is kept for cleanup.
  await store.saveOnboarding({...await store.getOnboarding(),completed:false,ready:false});window.reload();await waitFor('document.body.textContent.includes("Set up as new")');await audit('Onboarding')
  console.log('PASS real renderer→IPC→MariaDB create/list refresh, existing-user selection, sanitized persistent error details, six-second success, all major-screen CSS and native editor selection/undo/redo')
 }catch(error){failed=true;console.error(error)}finally{clearTimeout(timeout);if(runtime){await runtime.resetRuntime(false).catch(error=>{failed=true;console.error('Scoped cleanup failed',error.message)});await runtime.pauseBackgroundWork();runtime.dispose()}window?.destroy();await (await import('../dist-electron/logs.js')).drainApplicationLogs();assert.deepEqual(inventory(),before);await writeFile('/private/tmp/vhostra-database-ui-proof.json',JSON.stringify({profile,scope,failed}));if(!failed)await rm(profile,{recursive:true,force:true,maxRetries:20,retryDelay:100});else console.error('Retained isolated UI fixture:',profile);app.exit(failed?1:0)}
})
