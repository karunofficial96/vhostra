import { execFileSync } from 'node:child_process';
import path from 'node:path';

type Value = { data: string; type: 'REG_SZ' | 'REG_EXPAND_SZ' };
export type Registry = { read(key: string, name: string): Value | null; write(key: string, name: string, value: Value): void; remove(key: string, name: string): void };
const environment = 'HKCU\\Environment';
const ownership = 'HKCU\\Software\\Vhostra\\CLI';
const normalize = (value: string) => path.win32.normalize(value.trim().replace(/[\\/]+$/, '')).toLowerCase();

export function changeWindowsUserPath(action: 'install' | 'uninstall', directory: string, registry: Registry): 'changed' | 'unchanged' {
  if (!path.win32.isAbsolute(directory) || /[\r\n;]/.test(directory)) throw new Error('Invalid Vhostra installation directory.');
  const current = registry.read(environment, 'Path');
  const raw = current?.data ?? '';
  const parts = raw ? raw.split(';') : [];
  const target = normalize(directory);
  const owned = registry.read(ownership, 'Directory')?.data;
  const index = parts.findIndex(part => part && normalize(part) === target);
  if (action === 'install') {
    if (index !== -1) return 'unchanged';
    // Always add our own separator. If the original PATH ended in ';', that
    // empty trailing component must still be there after we remove our entry.
    const next = raw ? `${raw};${directory}` : directory;
    if (next.length > 32767) throw new Error('The user PATH is too long to add Vhostra safely.');
    registry.write(environment, 'Path', { data: next, type: current?.type ?? 'REG_EXPAND_SZ' });
    registry.write(ownership, 'Directory', { data: directory, type: 'REG_SZ' });
    return 'changed';
  }
  if (!owned || normalize(owned) !== target) return 'unchanged';
  if (index !== -1) {
    parts.splice(index, 1);
    registry.write(environment, 'Path', { data: parts.join(';'), type: current?.type ?? 'REG_EXPAND_SZ' });
  }
  registry.remove(ownership, 'Directory');
  return index === -1 ? 'unchanged' : 'changed';
}

const systemRegistry: Registry = {
  read(key, name) {
    try {
      const output = execFileSync('reg.exe', ['query', key, '/v', name], { encoding: 'utf8', windowsHide: true });
      const row = output.split(/\r?\n/).find(line => new RegExp(`^\\s*${name}\\s+REG_(?:EXPAND_)?SZ\\s+`, 'i').test(line));
      const match = row?.match(/^\s*\S+\s+(REG_SZ|REG_EXPAND_SZ)\s+(.*)$/i);
      return match ? { type: match[1].toUpperCase() as Value['type'], data: match[2] } : null;
    } catch { return null; }
  },
  write(key, name, value) {
    execFileSync('reg.exe', ['add', key, '/v', name, '/t', value.type, '/d', value.data, '/f'], { stdio: 'ignore', windowsHide: true });
  },
  remove(key, name) {
    try { execFileSync('reg.exe', ['delete', key, '/v', name, '/f'], { stdio: 'ignore', windowsHide: true }); }
    catch { /* Already absent. */ }
  },
};

export function changeInstalledWindowsPath(action: 'install' | 'uninstall', directory: string): 'changed' | 'unchanged' {
  if (process.platform !== 'win32') throw new Error('Windows PATH integration requires Windows.');
  return changeWindowsUserPath(action, directory, systemRegistry);
}
