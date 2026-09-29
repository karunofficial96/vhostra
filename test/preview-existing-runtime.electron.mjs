// Read-only acceptance of the existing Vhostra runtime. Only a temporary preview cache is written.
import { app, BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { readFile, readdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
const profile = mkdtempSync(path.join(os.tmpdir(), 'vhostra-existing-preview-'))
app.setPath('userData', profile); app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
 let runtime; let failed=false
 try {
  const { VhostraStore } = await import('../dist-electron/store.js')
  const { DockerRuntimeController } = await import('../dist-electron/runtime.js')
  const { SiteUrlResolver } = await import('../dist-electron/site-url.js')
  const { SitePreviews } = await import('../dist-electron/previews.js')
  const { HostsFileManager } = await import('../dist-electron/hosts.js')
  const real = new VhostraStore(path.join(os.homedir(), 'Library/Application Support/vhostra'))
  const records = async directory => Promise.all((await readdir(directory)).filter(file=>file.endsWith('.json')).map(async file=>JSON.parse(await readFile(path.join(directory,file),'utf8'))))
  const state={settings:JSON.parse(await readFile(path.join(real.layout.root,'settings.json'),'utf8')),sites:await records(real.layout.sites),virtualHosts:await records(real.layout.virtualHosts)}
  // Keep Site definitions/runtime layout in memory. Do not initialize or mutate the user store.
  const cache=new Map(); const store={layout:real.layout,getState:async()=>state,readScreenshot:async id=>cache.get(id),saveScreenshot:async(id,_url,data,source,_expected,routing)=>{cache.set(id,{data});state.sites.find(site=>site.id===id).screenshot={cacheFile:id+'.jpg',capturedAt:new Date().toISOString(),source,...routing};await writeFile(path.join(profile,id+'.jpg'),data)}}
  runtime=new DockerRuntimeController(real.layout,async()=>state)
  const hosts=new HostsFileManager(path.join(profile,'hosts-temp'))
  const legacy=new SiteUrlResolver(store,()=>hosts,()=>({running:true,https:true}))
  const resolver=new SiteUrlResolver(store,()=>hosts,()=>({running:true,https:true}),(url,id)=>runtime.verifyLegacyPreviewRoute(url,id))
  const previews=new SitePreviews(store,resolver)
  for(const site of state.sites){
   const before=await legacy.resolve(site.id);assert.equal(before.available,false);assert.match(before.details,/Routing verification failed/)
   console.log('REPRODUCED',site.builtIn?'localhost':'existing named','HTTP 200 rejected for missing identity')
   const resolved=await resolver.resolve(site.id);console.log('Resolved',site.builtIn?'localhost':'existing named',resolved.available,resolved.message,resolved.details??'');assert.equal(resolved.available,true)
   const captured=await previews.capture(site.id,true);console.log('Capture',site.builtIn?'localhost':'existing named',captured.captured,captured.details??'');assert.equal(captured.captured,true);assert.equal(BrowserWindow.getAllWindows().length,0);await writeFile(`/private/tmp/vhostra-additive-existing-${site.builtIn?'localhost':'named'}.jpg`,cache.get(site.id).data)
  }
  const builtin=state.sites.find(site=>site.builtIn);for(const named of state.sites.filter(site=>!site.builtIn))assert.notDeepEqual(cache.get(named.id).data,cache.get(builtin.id).data,'named screenshot differs from default');
  console.log('PASS both actual existing-runtime previews, unchanged runtime/Site/Hosts/database; ephemeral cache:',profile)
 }catch(error){failed=true;console.error(error)}finally{runtime?.dispose();for(const window of BrowserWindow.getAllWindows())window.destroy();if(!failed)await rm(profile,{recursive:true,force:true});app.exit(failed?1:0)}
})
