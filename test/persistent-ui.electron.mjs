import assert from 'node:assert/strict'
import { app, dialog, Menu } from 'electron'
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
const profile=mkdtempSync(path.join(os.tmpdir(),'vhostra-persistent-ui-'));app.setPath('userData',profile)
app.commandLine.appendSwitch('host-resolver-rules','MAP *.test 127.0.0.1, EXCLUDE localhost') // Test-only mapping; system Hosts stay untouched.
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const timeout=setTimeout(()=>{console.error('UI acceptance timeout');app.exit(1)},90000)
app.whenReady().then(async()=>{
 let server;let external;let runtime;let window;let failed=false;let routeId
 try {
  const {VhostraStore}=await import('../dist-electron/store.js');const store=new VhostraStore(profile,path.resolve('dist-welcome'));const state=await store.getState()
  server=http.createServer((request,response)=>{response.setHeader('X-Vhostra-Site',routeId??'default');response.setHeader('Content-Type','text/html');response.end('<!doctype html><body style="margin:0;background:#f2f2f2;font:32px sans-serif"><section style="height:720px;background:#065fd4;color:white;padding:32px;box-sizing:border-box">Local Site homepage preview<br>'+request.headers.host+'</section><div style="height:6000px">This long page must not be captured in full.</div><img src="https://remote.invalid/sensitive-site-name"></body>')})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port
  await store.saveSettings({...state.settings,ports:{...state.settings.ports,http:port},startup:{...state.settings.startup,serviceStartMode:'manual'}})
  await store.saveOnboarding({...await store.getOnboarding(),theme:'dark',completed:true,themeSaved:true})
  external=await mkdtemp(path.join(os.tmpdir(),'vhostra-preview-ui-site-'));await writeFile(path.join(external,'sentinel'),'untouched')
  const site=(await store.addSite({name:'Preview fixture',url:`http://preview.test:${port}/`,documentRoot:external})).sites.find(site=>!site.builtIn);routeId=site.vhostId
  const missing=(await store.addSite({name:'Unmapped fixture',url:`http://unmapped.test:${port}/`,documentRoot:external})).sites.find(s=>s.name==='Unmapped fixture')
  const wrong=(await store.addSite({name:'Wrong routing fixture',url:`http://wrong.test:${port}/`,documentRoot:external})).sites.find(s=>s.name==='Wrong routing fixture')
  const {applicationSession}=await import('../dist-electron/main.js');await pause(700);const native=applicationSession();window=native.window;runtime=native.runtime;runtime.scope=`vhostra-ui-${process.pid}`;await runtime.pauseBackgroundWork()
  const tempPreviewHosts=path.join(profile,'preview-hosts');await writeFile(tempPreviewHosts,'127.0.0.1 preview.test wrong.test\n');Object.defineProperty(native.hosts,'hostsPath',{value:tempPreviewHosts,configurable:true})
  runtime.refresh=async()=>runtime.set({state:'running',services:['runtime'],message:'Native UI fixture'});runtime.listManagedServices=async()=>[{id:'web',label:'OpenLiteSpeed',enabled:true,state:'running'},{id:'mariadb',label:'MariaDB',enabled:true,state:'running'}];runtime.listDatabases=async()=>['fixture_db'];runtime.listDatabaseUsers=async()=>[]
  // This unattended acceptance window can be occluded by the test runner.
  // Keep its renderer timers active solely for the six-second alert check.
  window.webContents.setBackgroundThrottling(false)
  const evaluate=code=>window.webContents.executeJavaScript(code)
  const waitFor=async expression=>{const end=Date.now()+20000;while(!await evaluate(expression)){if(Date.now()>end)throw Error(`Timed out: ${expression}`);await pause(100)}}
  const click=label=>evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(button=>button.textContent.trim()===${JSON.stringify(label)});if(!button)throw Error('Missing button '+${JSON.stringify(label)});button.click()})()`)
  await waitFor('document.body.textContent.includes("Dashboard")');await runtime.refresh()
  // Real IPC, capture window, loopback HTTP/Host, host cache and protocol image.
  await waitFor('!!document.querySelector("img[alt=\\"Preview fixture local site preview\\"]")')
  await waitFor(`document.querySelector('[data-preview-site="${missing.id}"]')?.textContent.includes('not mapped locally')`);await waitFor(`document.querySelector('[data-preview-site="${wrong.id}"]')?.textContent.includes('did not confirm this Site')`);await pause(200);await writeFile('/private/tmp/vhostra-preview-dashboard.png',(await window.webContents.capturePage()).toPNG())
  const saved=(await store.getState()).sites.find(item=>item.id===site.id);assert.ok(saved.screenshot);assert.equal(saved.screenshot.url,`http://preview.test:${port}/`);await evaluate('[...document.querySelectorAll("summary")].find(e=>e.textContent==="Preview information").click()');assert.equal(await evaluate('getComputedStyle(document.querySelector("[data-preview-site] dt")).userSelect'), 'none');assert.equal(await evaluate('getComputedStyle(document.querySelector("[data-preview-site] dd")).userSelect'), 'text')
  await evaluate(`(()=>{const card=document.querySelector('[data-preview-site="${site.id}"]');[...card.querySelectorAll('button')].find(button=>button.textContent==='Refresh Preview').click()})()`);await waitFor(`document.querySelector('[data-preview-site="${site.id}"]')?.textContent.includes('Preview updated successfully.')`);
  routeId=wrong.vhostId;runtime.set({state:'starting',services:['runtime'],message:'Fixture recovery'});await runtime.refresh();const recovered=await evaluate(`window.vhostra.capturePreview(${JSON.stringify(wrong.id)},false)`);assert.equal(recovered.captured,true,'healthy transition must retry recent failures');routeId=site.vhostId
  runtime.set({state:'starting',services:['runtime'],message:'Fixture rebuild'});await pause(150);assert.ok(await evaluate('[...document.images].some(img => img.alt === "Preview fixture local site preview")'),'retain previous image during rebuild');await runtime.refresh();await pause(100)
  const image=await store.readScreenshot(site.id);assert.ok(image.data.length<1024*1024)
  const {nativeImage}=await import('electron');assert.deepEqual(nativeImage.createFromBuffer(image.data).getSize(),{width:960,height:540})
  await pause(200); await writeFile('/private/tmp/vhostra-local-preview.jpg',image.data)
  await click('Sites')
  await waitFor('document.body.textContent.includes("Check Site")')
  assert.ok((await evaluate(`(()=>{const labels=[...document.querySelectorAll('dt')].filter(node=>['Server Name','Server Alias','Access Log','Error Log'].includes(node.textContent));return labels.map(label=>[getComputedStyle(label).userSelect,getComputedStyle(label.nextElementSibling).userSelect])})()`)).every(([label,value])=>label==='none'&&value==='text'))
  await evaluate(`(()=>{const edit=[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='Edit Preview fixture');const row=edit.parentElement.parentElement;[...row.querySelectorAll('button')].find(b=>b.textContent==='Check Site').click()})()`)
  await waitFor('document.body.textContent.includes("Site routing verified.")')
  assert.equal((await evaluate(`window.vhostra.resolveSiteUrl(${JSON.stringify(site.id)})`)).url,`http://preview.test:${port}/`)
  await click('Dashboard');await waitFor('document.body.textContent.includes("Refresh Preview")')
  await rm(path.join(store.layout.screenshots,saved.screenshot.cacheFile));window.reload();await waitFor('[...document.images].some(img => img.alt === "Preview fixture local site preview")');{const end=Date.now()+20000;while((await store.getState()).sites.find(s=>s.id===site.id).screenshot?.capturedAt===saved.screenshot.capturedAt){if(Date.now()>end)throw Error('Missing cache file did not regenerate');await pause(100)}}
  // Tray resource is stable; redundant Open item follows actual visibility.
  let labels=[];const tray=native.tray;const setMenu=tray.setContextMenu.bind(tray);tray.setContextMenu=menu=>{labels=menu.items.map(item=>item.label);setMenu(menu)}
  window.hide();{const end=Date.now()+5000;while(!labels.includes('Open Vhostra')){if(Date.now()>end)throw Error('Tray did not offer Open after native hide');await pause(100)}}window.show();{const end=Date.now()+5000;while(labels.includes('Open Vhostra')){if(Date.now()>end)throw Error('Tray retained Open after native show');await pause(100)}}assert.equal(applicationSession().tray,tray)
  const menu=Menu.getApplicationMenu();const quit=menu.items[0].submenu.items.find(item=>item.label==='Quit Vhostra');assert.ok(quit);quit.click();await waitFor('document.querySelector("[aria-labelledby=quit-title]") !== null');await pause(200); await writeFile('/private/tmp/vhostra-explicit-quit.png',(await window.webContents.capturePage()).toPNG())
  assert.match(await evaluate('document.querySelector("[aria-labelledby=quit-title]").textContent'),/Quit Vhostra and Keep Services Running/);await click('Cancel');await pause(100);assert.equal(window.isDestroyed(),false)
  app.quit();await waitFor('document.querySelector("[aria-labelledby=quit-title]") !== null');await click('Cancel')
  await runtime.refresh(); await pause(100); await click('Database');await waitFor('document.body.textContent.includes("fixture_db")')
  dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path.join(profile,'test.sql')]});await writeFile(path.join(profile,'test.sql'),'fixture')
  runtime.importDatabase=async()=>({database:'fixture_db',message:'Imported fixture'})
  await evaluate(`document.querySelector('main > section > div.overflow-auto').scrollTop=9999`);await click('Import');await waitFor('document.body.textContent.includes("Database imported successfully")');await waitFor(`(()=>{const pane=document.querySelector('main > section > div.overflow-auto'),result=document.getElementById('database-result');return Math.abs(result.getBoundingClientRect().top-pane.getBoundingClientRect().top)<=2})()`);await pause(200); await writeFile('/private/tmp/vhostra-import-success.png',(await window.webContents.capturePage()).toPNG());await pause(6300);assert.ok(!await evaluate('document.body.textContent.includes("Database imported successfully")'))
  await evaluate(`document.querySelector('main > section > div.overflow-auto').scrollTop=200`);const beforeBackground=await evaluate(`document.querySelector('main > section > div.overflow-auto').scrollTop`);runtime.set({state:'running',message:'Background fixture refresh.',services:['runtime'],serviceRevision:891});await pause(300);assert.equal(await evaluate(`document.querySelector('main > section > div.overflow-auto').scrollTop`),beforeBackground)
    runtime.importDatabase=async()=>{throw Error('ERROR 1064 at line 4: SQL syntax error; statement omitted')};await evaluate(`document.querySelector('main > section > div.overflow-auto').scrollTop=9999`);await click('Import');await waitFor('document.querySelector("[role=alert]")?.textContent.includes("ERROR 1064")');await waitFor(`(()=>{const pane=document.querySelector('main > section > div.overflow-auto'),result=document.getElementById('database-result');return Math.abs(result.getBoundingClientRect().top-pane.getBoundingClientRect().top)<=2})()`);await pause(200); await writeFile('/private/tmp/vhostra-import-error.png',(await window.webContents.capturePage()).toPNG())
  await click('Settings');assert.equal((await window.webContents.executeJavaScript(`window.vhostra.capturePreview(${JSON.stringify(site.id)},true)`)).captured,false);await click('Reset Vhostra…');await click('Keep configurations');assert.match(await evaluate('document.querySelector("[aria-labelledby=reset-title]").textContent'),/preserved/);await click('No');await click('Reset Vhostra…');await click('Remove configurations');assert.match(await evaluate('document.querySelector("[aria-labelledby=reset-title]").textContent'),/removed\/reset/);await click('No')
  await new Promise(resolve=>server.close(resolve));server=null
  const {SitePreviews}=await import('../dist-electron/previews.js');const {SiteUrlResolver}=await import('../dist-electron/site-url.js');const fallback=await new SitePreviews(store,new SiteUrlResolver(store,()=>native.hosts,()=>({running:false,https:false}))).capture(site.id,true);assert.equal(fallback.captured,false);assert.match(fallback.message,/stopped/)
  assert.equal(await readFile(path.join(external,'sentinel'),'utf8'),'untouched')
  // Real GUI → IPC → host reset. Docker has no resources in this fixture scope;
  // managed database bytes are real and external project files stay untouched.
  const databaseMarker=path.join(store.layout.persistentData.mariaDb,'gui-reset-identity');await writeFile(databaseMarker,'users/grants/roles fixture')
  const configureResetFixture=async()=>{
    const current=applicationSession();runtime=current.runtime;runtime.scope=`vhostra-ui-${process.pid}`
    const tempHosts=path.join(profile,'test-hosts');await writeFile(tempHosts,'127.0.0.1 localhost\n# unrelated fixture\n')
    Object.defineProperty(current.hosts,'hostsPath',{value:tempHosts,configurable:true})
  }
  await configureResetFixture();await click('Reset Vhostra…');await click('Keep configurations');await click('Yes, Reset Vhostra');await waitFor('document.body.textContent.includes("Set up as new")')
  assert.equal(await readFile(databaseMarker,'utf8'),'users/grants/roles fixture');assert.equal((await store.getState()).sites.length,4)
  await store.saveOnboarding({...await store.getOnboarding(),completed:true});window.reload();await waitFor('document.body.textContent.includes("Dashboard")')
  await configureResetFixture();await click('Settings');await click('Reset Vhostra…');await click('Remove configurations');await click('Yes, Reset Vhostra');await waitFor('document.body.textContent.includes("Set up as new")')
  await assert.rejects(stat(databaseMarker),/ENOENT/);assert.equal((await store.getState()).sites.length,1);assert.equal(await readFile(path.join(external,'sentinel'),'utf8'),'untouched')
  console.log('PASS native renderer/IPC: local viewport/cached screenshot, unavailable fallback, tray visibility, native Quit/Cancel, six-second SQL success and expandable error alerts, reset copy, external root retention')
 }catch(error){failed=true;console.error(error); if(window)console.error(await window.webContents.executeJavaScript("document.body.textContent"))}finally{clearTimeout(timeout);await runtime?.pauseBackgroundWork();runtime?.dispose();window?.destroy();if(server)await new Promise(resolve=>server.close(resolve));await (await import('../dist-electron/logs.js')).drainApplicationLogs();await writeFile('/private/tmp/vhostra-persistent-ui-proof.json',JSON.stringify({profile,external,failed}));app.exit(failed?1:0)}
})
