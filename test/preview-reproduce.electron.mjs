import { mkdtempSync } from 'node:fs'
import {app,BrowserWindow,session} from 'electron'
import http from 'node:http'
import {mkdtemp,rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
const browserProfile=mkdtempSync(path.join(os.tmpdir(),'vhostra-preview-browser-'));app.setPath('userData',browserProfile)
app.on('window-all-closed',()=>{});app.whenReady().then(async()=>{
 const {VhostraStore}=await import('../dist-electron/store.js')
 const profile=await mkdtemp(path.join(os.tmpdir(),'vhostra-preview-reproduce-'));const external=await mkdtemp(path.join(os.tmpdir(),'vhostra-preview-root-'))
 const server=http.createServer((req,res)=>{console.log('REQUEST',req.headers.host);res.end('DEFAULT OR NAMED '+req.headers.host)})
 try {await new Promise(r=>server.listen(0,'127.0.0.1',r));const store=new VhostraStore(profile,path.resolve('dist-welcome'));const state=await store.getState();const port=server.address().port;await store.saveSettings({...state.settings,ports:{...state.settings.ports,http:port}});const site=(await store.addSite({name:'Reproduction',documentRoot:external,url:`http://example.test:${port}/`})).sites.find(x=>!x.builtIn);const partition=session.fromPartition('vhostra-original-reproduction');partition.webRequest.onBeforeSendHeaders((details,callback)=>callback({requestHeaders:{...details.requestHeaders,Host:new URL(site.url).host}}));const window=new BrowserWindow({show:false,width:1280,height:720,webPreferences:{session:partition,sandbox:true,contextIsolation:true,nodeIntegration:false,offscreen:true,backgroundThrottling:false}});const url=new URL(site.url);url.hostname='127.0.0.1';console.log('LEGACY LOAD URL',url.toString());try{await window.loadURL(url.toString());console.log('Legacy load completed on this build; reported ERR_INVALID_ARGUMENT did not recur.')}catch(error){console.log(error.message)}finally{window.destroy();partition.webRequest.onBeforeSendHeaders(null);await partition.closeAllConnections()}}
 finally{console.log('Test browser profile',browserProfile);server.closeAllConnections();await new Promise(r=>server.close(r));await rm(profile,{recursive:true,force:true});await rm(external,{recursive:true,force:true});app.exit()}
})
