import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtemp, rm, writeFile, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { VhostraStore } from '../dist-electron/store.js'
import { HostsFileManager } from '../dist-electron/hosts.js'
import { SiteUrlResolver, siteUrlCandidates, previewMatches, previewIdentity, publicSiteUrl, previewErrorText } from '../dist-electron/site-url.js'
const fixture = async run => {
 const root=await mkdtemp(path.join(os.tmpdir(),'vhostra-preview-contract-'));const external=await mkdtemp(path.join(os.tmpdir(),'vhostra-preview-external-'));const store=new VhostraStore(root,path.resolve('dist-welcome'));const state=await store.getState();const hosts=new HostsFileManager(path.join(root,'temporary'));Object.defineProperty(hosts,'hostsPath',{value:path.join(root,'test-hosts')});await writeFile(hosts.hostsPath,'127.0.0.1 example.test www.example.test\n');let mode='named';let requests=[];let id
 const server=http.createServer((req,res)=>{requests.push(req.headers.host);const name=req.headers.host.split(':')[0];if(mode!=='legacy')res.setHeader('X-Vhostra-Site', mode==='wrong'||name==='example.test'&&mode==='alias'?'default':id);if(mode==='external'){res.writeHead(302,{Location:'https://external.invalid/private-site'});res.end()}else res.end(name)})
 try {await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await store.saveSettings({...state.settings,ports:{...state.settings.ports,http:port}});const site=(await store.addSite({name:'Example',url:`http://example.test:${port}/`,documentRoot:external,aliases:['www.example.test']})).sites.find(x=>!x.builtIn);id=site.vhostId;const resolver=new SiteUrlResolver(store,()=>hosts,()=>({running:mode!=='offline',https:false}));await run({store,site,resolver,hosts,port,requests,setMode:value=>{mode=value}})}finally{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});await rm(external,{recursive:true,force:true})}
}
test('canonical named routing, alias fallback and default-vhost rejection use real responses',()=>fixture(async({resolver,site,port,setMode,requests})=>{
 let result=await resolver.resolve(site.id);assert.equal(result.url,`http://example.test:${port}/`);assert.ok(!requests.some(host=>host.startsWith('127.0.0.1')))
 setMode('alias');result=await resolver.resolve(site.id);assert.equal(result.url,`http://www.example.test:${port}/`)
 setMode('wrong');result=await resolver.resolve(site.id);assert.equal(result.available,false);assert.match(result.details,/Routing verification failed/)
 setMode('external');result=await resolver.resolve(site.id);assert.equal(result.available,false);assert.match(result.details,/outside its mapped local URLs/)
}))
test('missing/conflicting mappings and stopped web cause no request or Hosts write',()=>fixture(async({resolver,site,hosts,setMode,requests})=>{
 await writeFile(hosts.hostsPath,'192.0.2.1 example.test\n');const before=await readFile(hosts.hostsPath,'utf8');let result=await resolver.resolve(site.id);assert.equal(result.available,false);assert.match(result.message,/not mapped/);assert.equal(requests.length,0);assert.equal(await readFile(hosts.hostsPath,'utf8'),before)
 setMode('offline');result=await resolver.resolve(site.id);assert.match(result.message,/stopped/);assert.equal(requests.length,0)
}))
test('cache survives PHP/server/unused alias changes, invalidates removed preview alias, hostname and ports',()=>fixture(async({store,site,port})=>{
 let state=await store.getState();const identity=previewIdentity(state,site);const url=`http://example.test:${port}/`;await store.saveScreenshot(site.id,site.url,Buffer.from('fixture'),'manual',undefined,{url,identity})
 await store.saveSettings({...state.settings,selectedWebServer:'nginx',selectedPhpVersion:'8.4'});state=await store.getState();assert.ok(previewMatches(state,state.sites.find(x=>x.id===site.id)))
 await store.updateSite({...site,aliases:['www.example.test','new.example.test']});state=await store.getState();assert.ok(previewMatches(state,state.sites.find(x=>x.id===site.id)))
 await store.saveScreenshot(site.id,site.url,Buffer.from('fixture'),'manual',undefined,{url:`http://www.example.test:${port}/`,identity});await store.updateSite({...site,aliases:['new.example.test']});state=await store.getState();assert.equal(state.sites.find(x=>x.id===site.id).screenshot,undefined);await assert.rejects(stat(path.join(store.layout.screenshots,`${site.id}.jpg`)),/ENOENT/)
 const host=state.virtualHosts.find(x=>x.id===site.vhostId);host.https.enabled=true;assert.deepEqual(siteUrlCandidates(state,site,true).slice(0,2),[`https://example.test/`,url]);assert.deepEqual(siteUrlCandidates(state,site,false),[url,`http://new.example.test:${port}/`])
}))

test('preview and health URL metadata omit credentials, query and fragment state',()=>assert.equal(publicSiteUrl('https://example.test:9443/page?token=private#password=hidden'),'https://example.test:9443/page'))

test('configured homepage path/query are honored privately and omitted from routing error metadata',()=>fixture(async({store,site,resolver,port,setMode})=>{
 await store.updateSite({...site,url:`http://example.test:${port}/landing?token=private-fixture`})
 let result=await resolver.resolve(site.id);assert.equal(result.url,`http://example.test:${port}/landing?token=private-fixture`)
 setMode('wrong');result=await resolver.resolve(site.id);assert.equal(result.available,false);assert.doesNotMatch(result.details,/private-fixture/)
 const state=await store.getState();assert.doesNotMatch(previewIdentity(state,state.sites.find(s=>s.id===site.id)),/private-fixture/)
}))

test('capture errors remove encoded credential query/fragment state from attempted URLs',()=>assert.equal(previewErrorText('ERR_FAILED opening https://example.test/?%74oken=private#secret-state'),'ERR_FAILED opening https://example.test/'))

test('missing identity needs independent server proof; a mismatching identity never uses fallback',()=>fixture(async({resolver,store,site,hosts,setMode})=>{
 setMode('legacy');assert.equal((await resolver.resolve(site.id)).available,false)
 let proofs=0;const proven=new SiteUrlResolver(store,()=>hosts,()=>({running:true,https:false}),async()=>{proofs++;return true})
 assert.equal((await proven.resolve(site.id)).available,true);assert.equal(proofs,1)
 setMode('wrong');assert.equal((await proven.resolve(site.id)).available,false);assert.equal(proofs,1)
}))
