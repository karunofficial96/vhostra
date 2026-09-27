// Temporary ad hoc signed macOS bundle for honest app.isPackaged resource measurements.
// It is not an installer or release-signing workflow.
import { cp, mkdtemp, mkdir, rm, writeFile, rename } from 'node:fs/promises'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
if (process.platform !== 'darwin') throw Error('This measurement fixture currently supports macOS only.')
const root=await mkdtemp(path.join('/private/tmp','vhostra-packaged-measurement-'))
try {
 const bundle=path.join(root,'Vhostra Performance.app')
 await cp('node_modules/electron/dist/Electron.app',bundle,{recursive:true,verbatimSymlinks:true})
 await rename(path.join(bundle,'Contents','MacOS','Electron'),path.join(bundle,'Contents','MacOS','Vhostra'))
 const plist=path.join(bundle,'Contents','Info.plist')
 for(const [key,value] of [['CFBundleExecutable','Vhostra'],['CFBundleName','Vhostra Performance'],['CFBundleIdentifier','com.vhostra.performance-test']]) execFileSync('/usr/libexec/PlistBuddy',['-c',`Set :${key} ${value}`,plist])
 const resources=path.join(bundle,'Contents','Resources'); const application=path.join(resources,'app')
 await mkdir(path.join(application,'test'),{recursive:true})
 for(const directory of ['dist','dist-electron','dist-welcome','build','runtime-image']) await cp(directory,path.join(application,directory),{recursive:true})
 await cp('test/performance.electron.mjs',path.join(application,'test/performance.electron.mjs'))
 for(const name of ['trayIcon.png','trayIcon@2x.png']) await cp(path.join('build',name),path.join(resources,name))
 await writeFile(path.join(application,'package.json'),JSON.stringify({name:'vhostra',version:'1.0.0',type:'module',main:'test/performance.electron.mjs'}))
 execFileSync('codesign',['--force','--deep','--sign','-',bundle],{stdio:'ignore'})
 const environment={...process.env};delete environment.ELECTRON_RUN_AS_NODE;delete environment.VITE_DEV_SERVER_URL;delete environment.NODE_ENV
 const child=spawn(path.join(bundle,'Contents','MacOS','Vhostra'),[],{env:environment,stdio:'inherit'})
 process.once('SIGINT',()=>child.kill('SIGTERM'));process.once('SIGTERM',()=>child.kill('SIGTERM'))
 process.exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1))})
} finally { await rm(root,{recursive:true,force:true}) }
