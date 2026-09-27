import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, access, rm } from 'node:fs/promises';
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
        runtime.requireDocker = runtime.ensurePortsAvailable = runtime.checkOptionalHttpsPort = runtime.provisionPhpMyAdmin = async () => {};
        runtime.docker = async () => '';
        runtime.compose = async (args) => {
            if (args[0] === 'images') return 'immutable-image-id';
            if (args[0] === 'build') throw new Error('promotion failed');
            if (args.includes('--no-build') && recoveryFails) throw new Error('recovery failed');
            return '';
        };
        runtime.generate = async () => writeFile(path.join(runtime.runtimeRoot, 'compose.yml'), 'broken-new');
        runtime.healthCheck = async () => assert.equal(await readFile(path.join(runtime.runtimeRoot, 'compose.yml'), 'utf8'), 'verified-original');
        await assert.rejects(runtime.restart(), error => {
            if (recoveryFails) {
                assert.match(error.message, /Recovery files were retained at/);
                backup = error.message.match(/retained at (.+?)\. recovery failed/)[1];
            } else assert.match(error.message, /rolled back to the verified previous/);
            return true;
        });
        assert.equal(await readFile(path.join(runtime.runtimeRoot, 'compose.yml'), 'utf8'), 'verified-original');
        if (backup) {
            await access(path.join(backup, 'runtime/healthy-state.json'));
            assert.equal(await readFile(path.join(backup, 'runtime/compose.yml'), 'utf8'), 'verified-original');
        }
    } finally {
        runtime?.dispose();
        if (backup) await rm(backup, { recursive: true, force: true });
        await rm(root, { recursive: true, force: true });
    }
});
