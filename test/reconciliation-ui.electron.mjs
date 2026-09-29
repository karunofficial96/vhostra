import assert from 'node:assert/strict'
import { app, Menu, clipboard, ClipboardItem } from 'electron'
import { mkdtempSync } from 'node:fs'
import { writeFile, readFile, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import os from 'node:os'
import path from 'node:path'
const profile=mkdtempSync(path.join(os.tmpdir(),'vhostra-reconcile-ui-'));app.setPath('userData',profile)
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));const run=promisify(execFile)
app.whenReady().then(async()=>{
 let native;let previousClipboard;let failed=false;const timeout=setTimeout(()=>app.exit(1),150000)
 try {
  const {VhostraStore}=await import('../dist-electron/store.js');const store=new VhostraStore(profile,path.resolve('dist-welcome'));await store.getState();await store.saveOnboarding({...await store.getOnboarding(),completed:true,theme:'dark'})
  const {applicationSession}=await import('../dist-electron/main.js');await pause(700);native=applicationSession();const {window,runtime,hosts}=native;runtime.scope=`vhostra-reconcile-ui-${process.pid}`
  runtime.refresh=async()=>runtime.set({state:'stopped',services:[],message:'Isolated UI acceptance'});runtime.listManagedServices=async()=>[]
  const tempHosts=path.join(profile,'hosts');const original='# Original comment\n127.0.0.1 localhost\n';await writeFile(tempHosts,original);Object.defineProperty(hosts,'hostsPath',{value:tempHosts});hosts.platform='linux';let elevations=0;hosts.execute=async(_command,args)=>{elevations++;await run(args[0],args.slice(1))}
  const evaluate=code=>window.webContents.executeJavaScript(code);const waitFor=async expression=>{const end=Date.now()+60000;while(!await evaluate(expression)){if(Date.now()>end)throw Error(expression);await pause(50)}}
  const click=label=>evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!b)throw Error('Missing '+${JSON.stringify(label)});b.click()})()`)
  await waitFor('document.body.textContent.includes("Dashboard")');await click('Settings');await click('Inspect Hosts file');await waitFor('!!document.querySelector("textarea[aria-label=\\"Hosts file contents\\"]")')
  assert.equal(await evaluate('getComputedStyle(document.querySelector("h1")).userSelect'),'none');assert.equal(await evaluate('getComputedStyle(document.querySelector("textarea")).userSelect'),'text')
  assert.deepEqual(Menu.getApplicationMenu().items.filter(item=>item.visible).map(item=>item.label),['Vhostra'])
  await click('Edit complete Hosts file');assert.equal(await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Undo").disabled'),true)
  await evaluate('document.querySelector("textarea[aria-label=\\"Hosts file contents\\"]").focus()');window.webContents.undo();await pause(50);assert.equal(await evaluate('document.querySelector("textarea").value'),original);await window.webContents.insertText('# Typed edit\n');await pause(50)
  const typed=await evaluate('document.querySelector("textarea").value');assert.notEqual(typed,original);assert.equal(elevations,0)
  await click('Undo');assert.equal(await evaluate('document.querySelector("textarea").value'),original);await click('Redo');assert.equal(await evaluate('document.querySelector("textarea").value'),typed)
  await click('Restore Original');assert.equal(await evaluate('document.querySelector("textarea").value'),original);await click('Undo');assert.equal(await evaluate('document.querySelector("textarea").value'),typed)
  // Hidden native editing accelerators still support text-field Select All/Copy/Paste.
  window.show();app.focus({steal:true});window.focus();await pause(100);await evaluate('document.querySelector("textarea").focus()');const selectAll=Menu.getApplicationMenu().items[0].submenu.items.find(item=>item.role==='selectall');assert.ok(selectAll || Menu.getApplicationMenu().items[0].submenu.items.find(item=>item.role==='selectAll'));
  if (process.env.VHOSTRA_NATIVE_KEYBOARD === '1') { await writeFile('/private/tmp/vhostra-native-keyboard-ready','ready'); await waitFor('document.querySelector("textarea").selectionEnd - document.querySelector("textarea").selectionStart === document.querySelector("textarea").value.length') }
  else { window.webContents.selectAll();await pause(100) }
  assert.equal(await evaluate('document.querySelector("textarea").selectionEnd - document.querySelector("textarea").selectionStart'),typed.length); if(process.env.VHOSTRA_NATIVE_KEYBOARD==='1')console.log('PASS actual OS Command+A with hidden editing menu')
  previousClipboard=await Promise.all((await clipboard.read()).map(async item=>new ClipboardItem(Object.fromEntries(await Promise.all(item.types.map(async type=>[type,await item.getType(type)]))))));window.webContents.copy();await pause(100);assert.ok(await clipboard.readText()===typed,'Selected Hosts text can be copied');await click('Review changes');await waitFor('!!document.querySelector("[role=dialog]")');await writeFile('/private/tmp/vhostra-reconciliation-hosts-review.png',(await window.webContents.capturePage()).toPNG());await click('Cancel');assert.equal(await readFile(tempHosts,'utf8'),original)
  await click('Edit complete Hosts file');await evaluate('document.querySelector("textarea").focus()');await window.webContents.insertText('# Saved edit\n');await click('Review changes');await waitFor('!!document.querySelector("[role=dialog]")');await click('Save Changes');await waitFor('document.body.textContent.includes("Hosts file saved and verified")');assert.equal(elevations,1)
  const saved=await readFile(tempHosts,'utf8');assert.notEqual(saved,original);await click('Edit complete Hosts file');await click('Restore Previous Hosts File');await waitFor('!!document.querySelector("[role=dialog]")');assert.equal(await evaluate('document.querySelector("textarea").value'),original);assert.equal(await readFile(tempHosts,'utf8'),saved);await click('Save Changes');await waitFor('!document.querySelector("[role=dialog]")');assert.equal(await readFile(tempHosts,'utf8'),original);assert.equal(elevations,2)
  // A delayed service query must not delay visibility or icon updates.
  const tray=applicationSession().tray;let labels=[];const setMenu=tray.setContextMenu.bind(tray);tray.setContextMenu=menu=>{labels=menu.items.map(item=>item.label);setMenu(menu)}
  let resolveRows;runtime.listManagedServices=()=>new Promise(resolve=>{resolveRows=resolve})
  console.log('TRAY before hide',window.isVisible(),window.isMinimized(),tray.isDestroyed());window.once('hide',()=>console.log('TRAY hide emitted'));native.hide();await pause(100);console.log('TRAY hidden menu',JSON.stringify(labels),window.isVisible(),applicationSession().tray===tray);assert.ok(labels.includes('Open Vhostra'));assert.ok(tray.getBounds().width>0);await native.open();await pause(20);assert.ok(!labels.includes('Open Vhostra'));resolveRows?.([]);runtime.listManagedServices=async()=>[];await pause(100)
  window.minimize();await pause(100);assert.ok(labels.includes('Open Vhostra'));assert.equal(applicationSession().tray,tray);assert.equal(tray.isDestroyed(),false);await native.open();await pause(100);assert.ok(!labels.includes('Open Vhostra'))
  window.close();await pause(150);assert.equal(window.isVisible(),false);assert.equal(tray.isDestroyed(),false);assert.ok(labels.includes('Open Vhostra'));await native.open();await pause(100)
  await click('Help & documentation');assert.equal(await evaluate('getComputedStyle([...document.querySelectorAll("h1")].find(h=>h.textContent.includes("Help"))).userSelect'),'text')
  console.log('PASS native renderer/IPC: bounded session history controls, original/previous recovery buffer, reviewed TEMP protected-write plan, CSS selection, hidden editing accelerator, retained tray and immediate menu under delayed service queries')
 }catch(error){failed=true;console.error(error);if(native?.window)console.error(await native.window.webContents.executeJavaScript('document.body.textContent'))}finally{if(previousClipboard)await clipboard.write(previousClipboard).catch(()=>{});clearTimeout(timeout);await native?.runtime.pauseBackgroundWork();native?.runtime.dispose();native?.window.destroy();await (await import('../dist-electron/logs.js')).drainApplicationLogs();try{if(!failed)await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:150});else console.error('Retained UI profile',profile)}catch(error){console.error('Profile cleanup:',error.message);failed=true}finally{app.exit(failed?1:0)}}
})
