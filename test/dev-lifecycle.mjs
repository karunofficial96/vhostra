// Opt-in native development lifecycle check; no real user profile or services.
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
const pause=ms=>new Promise(r=>setTimeout(r,ms))
const ps=()=>execFileSync('ps',['-axo','pid,ppid,pgid,%cpu,rss,comm'],{encoding:'utf8'}).trim().split('\n').slice(1).map(line=>{const [pid,ppid,pgid,cpu,rss,...comm]=line.trim().split(/\s+/);return {pid:+pid,ppid:+ppid,pgid:+pgid,cpu:+cpu,rssKiB:+rss,comm:comm.join(' ')}})
const descendants=(rows,pid)=>{const found=new Set([pid]);for(let n=0;n<rows.length;n++)for(const row of rows)if(found.has(row.ppid))found.add(row.pid);return rows.filter(row=>found.has(row.pid))}
for(const mode of ['interrupt-startup','electron-exit','ctrl-c']) {
 const profile=await mkdtemp(path.join(os.tmpdir(),'vhostra-dev-lifecycle-'))
 const child=spawn('npm',['run','dev'],{detached:true,stdio:['ignore','pipe','pipe'],env:{...process.env,VHOSTRA_DEV_PROFILE:profile,VHOSTRA_RESOURCE_DEBUG:'1'}})
 let output=''; child.stdout.on('data',v=>{output+=v;process.stdout.write(v)});child.stderr.on('data',v=>{output+=v;process.stderr.write(v)})
 const exit=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})))
 let tracked=[]
 try {
  if(mode==='interrupt-startup') { await pause(1500);tracked=descendants(ps(),child.pid);process.kill(-child.pid,'SIGINT') }
  else {
   const deadline=Date.now()+45000
   while(!output.includes('[Vhostra resources]')&&Date.now()<deadline) await pause(500)
   assert.ok(output.includes('[Vhostra resources]'),'Development diagnostics must produce a sample')
   tracked=descendants(ps(),child.pid)
   console.log('DEVELOPMENT_PROCESSES',JSON.stringify(tracked))
   const compiler=tracked.filter(row=>row.comm==='node'&&row.rssKiB>250000)
   assert.equal(compiler.length,1,'One shared TypeScript compiler')
   const mains=tracked.filter(row=>row.comm.endsWith('/Electron.app/Contents/MacOS/Electron'))
   assert.equal(mains.length,1,'One application main, excluding normal helpers')
   const duplicate=spawn('node',['scripts/dev.mjs'],{stdio:['ignore','pipe','pipe'],env:{...process.env,VHOSTRA_DEV_PROFILE:profile}})
   const duplicateExit=await new Promise(resolve=>duplicate.once('exit',resolve))
   assert.equal(duplicateExit,1,'Duplicate launcher must refuse before starting watchers')
   if(mode==='electron-exit') process.kill(mains[0].pid,'SIGTERM')
   else process.kill(-child.pid,'SIGINT')
  }
  await Promise.race([exit,pause(10000).then(()=>{throw Error('Dev cleanup timed out')})])
  await pause(1000)
  const remaining=ps().filter(row=>tracked.some(old=>old.pid===row.pid))
  assert.equal(remaining.length,0,`Orphan children after ${mode}: ${JSON.stringify(remaining)}`)
  console.log(`Lifecycle passed: ${mode}`)
 } finally {try{process.kill(-child.pid,'SIGTERM')}catch{};await rm(profile,{recursive:true,force:true})}
}
