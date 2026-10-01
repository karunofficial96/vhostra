import { promises as fs } from 'node:fs';
import path from 'node:path';

interface StartupEnvironment {
    platform: NodeJS.Platform;
    home: string;
    configHome?: string;
    executable: string;
    appPath: string;
    packaged: boolean;
    setLoginItemSettings(settings: { openAtLogin: boolean; args: string[] }): void;
    getLoginItemSettings(options: { args: string[] }): { openAtLogin: boolean; status?: string };
}

// Desktop Entry string escaping is applied after Exec argument quoting.
export function desktopArgument(value: string): string {
    if (/[\r\n\0]/.test(value)) throw new Error('Invalid startup executable path.');
    const quoted = value.replace(/%/g, '%%').replace(/[\\"`$]/g, '\\$&');
    return `"${quoted.replace(/\\/g, '\\\\')}"`;
}

export async function configureStartup(enabled: boolean, env: StartupEnvironment): Promise<void> {
    const args = [...(env.packaged ? [] : [env.platform === 'win32' ? `"${env.appPath}"` : env.appPath]), '--vhostra-login-start'];
    if (env.platform === 'linux') {
        const root = env.configHome && path.isAbsolute(env.configHome)
            ? env.configHome : path.join(env.home, '.config');
        const directory = path.join(root, 'autostart');
        const file = path.join(directory, 'vhostra.desktop');
        if (!enabled) {
            await fs.rm(file, { force: true });
            return;
        }
        if (env.executable.includes('=')) throw new Error('Linux startup executable paths cannot contain an equals sign.');
        const exec = [env.executable, ...args].map(desktopArgument).join(' ');
        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(file, `[Desktop Entry]\nType=Application\nName=Vhostra\nExec=${exec}\nX-GNOME-Autostart-enabled=true\n`, { mode: 0o600 });
        return;
    }
    env.setLoginItemSettings({ openAtLogin: enabled, args });
    const actual = env.getLoginItemSettings({ args });
    if (actual.openAtLogin !== enabled || (enabled && actual.status === 'requires-approval'))
        throw new Error('The operating system did not apply Vhostra’s login setting. Check login-item permissions in system settings.');
}
