import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, access, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { VhostraStore } from '../dist-electron/store.js';
import { DockerRuntimeController } from '../dist-electron/runtime.js';

for (const recoveryFails of [false, true]) test(`replacement recovery ${recoveryFails ? 'retains its backup on failure' : 'restores verified config'}`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'vhostra-recovery-test-'));
    let backup;
    let runtime;
    try {
        const store = new VhostraStore(root, path.resolve('dist-welcome'));
        const state = await store.getState();
        runtime = new DockerRuntimeController(store.layout, async () => state);
        await mkdir(runtime.runtimeRoot, { recursive: true });
        await writeFile(path.join(runtime.runtimeRoot, 'healthy-state.json'), JSON.stringify(state));
        await writeFile(path.join(runtime.runtimeRoot, 'compose.yml'), 'verified-original');
        await writeFile(path.join(store.layout.configuration.generated, 'apache-vhosts.conf'), '# Vhostra generated configuration; owner=vhostra; schema=1\nverified-host-config');
        runtime.prepareDatabase = runtime.startDatabase = runtime.requireDocker = runtime.ensurePortsAvailable = runtime.checkOptionalHttpsPort = runtime.provisionPhpMyAdmin = async () => {};
        runtime.docker = async () => '';
        if (!recoveryFails) runtime.cleanupImages = async () => { throw new Error('cache cleanup unavailable'); };
        runtime.compose = async (args) => {
            if (args[0] === 'images') return 'immutable-image-id';
            if (args[0] === 'build') throw new Error('promotion failed');
            if (args.includes('--no-build') && recoveryFails) throw new Error('recovery failed');
            return '';
        };
        runtime.generate = async () => { await writeFile(path.join(runtime.runtimeRoot, 'compose.yml'), 'broken-new'); await writeFile(path.join(store.layout.configuration.generated, 'apache-vhosts.conf'), 'broken-generated'); await writeFile(path.join(store.layout.configuration.generated, 'new-user-file.conf'), 'preserve-me'); };
        runtime.healthCheck = async () => assert.equal(await readFile(path.join(runtime.runtimeRoot, 'compose.yml'), 'utf8'), 'verified-original');
        await assert.rejects(runtime.restart(), error => {
            if (recoveryFails) {
                assert.match(error.message, /Recovery files were retained at/);
                backup = error.message.match(/retained at (.+?)\. recovery failed/)[1];
            } else assert.match(error.message, /rolled back to the verified previous/);
            return true;
        });
        assert.equal(await readFile(path.join(runtime.runtimeRoot, 'compose.yml'), 'utf8'), 'verified-original');
        assert.equal(await readFile(path.join(store.layout.configuration.generated, 'apache-vhosts.conf'), 'utf8'), '# Vhostra generated configuration; owner=vhostra; schema=1\nverified-host-config');
        assert.equal(await readFile(path.join(store.layout.configuration.generated, 'new-user-file.conf'), 'utf8'), 'preserve-me');
        if (backup) {
            await access(path.join(backup, 'runtime/healthy-state.json'));
            assert.equal(await readFile(path.join(backup, 'runtime/compose.yml'), 'utf8'), 'verified-original');
        } else assert.deepEqual((await readdir(store.layout.backups)).filter(name => name.startsWith('runtime-recovery-')), []);
    } finally {
        runtime?.dispose();
        if (backup) await rm(backup, { recursive: true, force: true });
        await rm(root, { recursive: true, force: true });
    }
});
test('legacy rollback regenerates web-only Compose before restarting beside independent MariaDB',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'vhostra-legacy-recovery-'));let runtime;
 try{
  const store=new VhostraStore(root,path.resolve('dist-welcome'));const state=await store.getState();runtime=new DockerRuntimeController(store.layout,async()=>state);
  await mkdir(runtime.runtimeRoot,{recursive:true});await writeFile(path.join(runtime.runtimeRoot,'healthy-state.json'),JSON.stringify(state));await writeFile(runtime.composeFile,'legacy bind /var/lib/mysql');
  runtime.prepareDatabase=runtime.startDatabase=runtime.requireDocker=runtime.ensurePortsAvailable=runtime.checkOptionalHttpsPort=runtime.provisionPhpMyAdmin=runtime.cleanupImages=async()=>{};runtime.docker=async()=>'';let generations=0;let recovered=false;
  runtime.generate=async()=>{generations++;await writeFile(runtime.composeFile,'web-only regenerated')};
  let builds=0;runtime.compose=async args=>{if(args[0]==='build'&&++builds===1)throw Error('new build failed');if(args[0]==='up'){assert.equal(await readFile(runtime.composeFile,'utf8'),'web-only regenerated');recovered=true}return ''};
  runtime.healthCheck=async()=>{};await assert.rejects(runtime.restart(),/rolled back to the verified previous/);assert.equal(generations,2);assert.ok(recovered);
 }finally{runtime?.dispose();await rm(root,{recursive:true,force:true})}
})
