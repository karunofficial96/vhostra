import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, access, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { configureStartup, desktopArgument } from '../dist-electron/startup.js';

test('Linux startup uses XDG location, preserves unrelated entries, and launches the correct app', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'vhostra-startup-'));
    const env = { platform: 'linux', home: root, configHome: path.join(root, 'xdg'), executable: '/opt/My App/electron', appPath: '/work/Vhostra', packaged: false };
    try {
        await configureStartup(true, env);
        const file = path.join(env.configHome, 'autostart/vhostra.desktop');
        const unrelated = path.join(env.configHome, 'autostart/other.desktop');
        await writeFile(unrelated, 'unrelated');
        assert.match(await readFile(file, 'utf8'), /Exec="\/opt\/My App\/electron" "\/work\/Vhostra" "--vhostra-login-start"/);
        await configureStartup(true, { ...env, packaged: true });
        assert.match(await readFile(file, 'utf8'), /Exec="\/opt\/My App\/electron" "--vhostra-login-start"\n/);
        await configureStartup(false, env);
        await assert.rejects(access(file), { code: 'ENOENT' });
        assert.equal(await readFile(unrelated, 'utf8'), 'unrelated');
        assert.equal(desktopArgument('/a$`"\\%b'), '"/a\\\\$\\\\`\\\\"\\\\\\\\%%b"');
        assert.throws(() => desktopArgument('bad\npath'));
        await assert.rejects(configureStartup(true, { ...env, configHome: unrelated }), { code: 'ENOTDIR' });
    } finally { await rm(root, { recursive: true, force: true }); }
});

for (const platform of ['darwin', 'win32']) {
    test(`${platform} startup verifies OS acceptance and passes development arguments`, async () => {
        let current = false;
        let received;
        const env = { platform, home: '/home/test', executable: '/app/electron', appPath: '/work/vhostra', packaged: false,
            setLoginItemSettings: (value) => { received = value; current = value.openAtLogin; },
            getLoginItemSettings: (options) => { assert.deepEqual(options.args, received?.args ?? []); return { openAtLogin: current }; } };
        await configureStartup(true, env);
        assert.deepEqual(received, { openAtLogin: true, args: [platform === 'win32' ? '"/work/vhostra"' : '/work/vhostra', '--vhostra-login-start'] });
        await configureStartup(false, { ...env, packaged: true });
        assert.deepEqual(received, { openAtLogin: false, args: ['--vhostra-login-start'] });
        await assert.rejects(configureStartup(true, { ...env, setLoginItemSettings: value => { received = value; } }), /operating system did not apply/);
        await assert.rejects(configureStartup(true, { ...env, setLoginItemSettings: () => { throw new Error('OS refused'); } }), /OS refused/);
        await assert.rejects(configureStartup(true, { ...env, getLoginItemSettings: () => ({ openAtLogin: true, status: 'requires-approval' }) }), /login-item permissions/);
    });
}
