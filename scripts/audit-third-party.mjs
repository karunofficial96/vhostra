// Local lockfile/installed-license audit. No network or application/user data access.
import { readFile, readdir, mkdir, copyFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
const lock=JSON.parse(await readFile('package-lock.json','utf8'))
const rows=[]
for(const [location,entry] of Object.entries(lock.packages)){
 if(!location)continue
 let pkg={};let files=[]
 try{pkg=JSON.parse(await readFile(path.join(location,'package.json'),'utf8'));files=(await readdir(location)).filter(file=>/^(?:LICENSE|LICENCE|COPYING|NOTICE)(?:\.|$|-)/i.test(file))}catch{}
 const name=pkg.name??location.split('node_modules/').at(-1);const destination=path.join('third-party-licenses/npm',location.replaceAll('/','__'));const retained=[]
 for(const file of files){try{const bytes=await readFile(path.join(location,file));await mkdir(destination,{recursive:true});await copyFile(path.join(location,file),path.join(destination,file));retained.push({file:path.join(destination,file),sha256:createHash('sha256').update(bytes).digest('hex')})}catch{}}
 const repository=typeof pkg.repository==='string'?pkg.repository:pkg.repository?.url??''
 rows.push({name,version:entry.version,location,lockLicense:entry.license??'Not declared',installedLicense:pkg.license??'Not installed on this platform',dev:Boolean(entry.dev),optional:Boolean(entry.optional),repository,licenseFiles:retained})
}
await mkdir('third-party-licenses',{recursive:true});await writeFile('third-party-licenses/npm-inventory.json',JSON.stringify(rows,null,2)+'\n')
const escape=value=>String(value).replaceAll('|','\\|').replaceAll('\n',' ')
await writeFile('third-party-licenses/NPM_INVENTORY.md','# Locked npm inventory\n\nGenerated from package-lock.json and installed package metadata with `node scripts/audit-third-party.mjs`. Lockfile dev flags are installation classifications; bundling/shipping roles are explained in THIRD_PARTY_NOTICES.md. Missing platform packages are explicitly recorded. Full copyright/notice text is retained in the linked files.\n\n| Package | Version | Declared license | Lock dev flag | Retained license/notice |\n| --- | --- | --- | --- | --- |\n'+rows.map(row=>`| ${escape(row.name)} | ${row.version} | ${escape(row.lockLicense)} | ${row.dev} | ${row.licenseFiles.map(item=>`[${path.basename(item.file)}](${path.relative('third-party-licenses',item.file)})`).join(', ')||'Verify platform artifact before shipping'} |`).join('\n')+'\n')
await copyFile('node_modules/electron/dist/LICENSE','third-party-licenses/Electron-LICENSE.txt')
await writeFile('third-party-licenses/Electron-Chromium-LICENSES.html.gz',gzipSync(await readFile('node_modules/electron/dist/LICENSES.chromium.html'),{mtime:0}))
console.log(`${rows.length} locked packages; ${rows.filter(row=>!row.licenseFiles.length).length} lack installed root license material (includes absent optional platforms).`)
