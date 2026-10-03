import { lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export type LinkResult = 'linked' | 'present' | 'conflict' | 'permission';

export function ensureOwnedCliLink(target: string, link: string): LinkResult {
  try {
    const entry = lstatSync(link);
    return entry.isSymbolicLink() && readlinkSync(link) === target ? 'present' : 'conflict';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  try {
    mkdirSync(path.dirname(link), { recursive: true });
    symlinkSync(target, link);
    return 'linked';
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') return 'conflict';
    if (code === 'EACCES' || code === 'EPERM') return 'permission';
    throw error;
  }
}

export function removeOwnedCliLink(target: string, link: string): boolean {
  try {
    if (!lstatSync(link).isSymbolicLink() || readlinkSync(link) !== target) return false;
    unlinkSync(link);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

// Only macOS's own administrator prompt can authorize a protected /usr/local/bin.
// The shell checks ownership again under elevation, so a racing command is kept.
export function authorizeMacCliLink(target: string, link: string, action: 'install' | 'remove'): Promise<boolean> {
  const destination = shellQuote(link);
  const source = shellQuote(target);
  const script = action === 'install'
    ? `mkdir -p ${shellQuote(path.dirname(link))} && if [ ! -e ${destination} ] && [ ! -L ${destination} ]; then ln -s ${source} ${destination}; else [ -L ${destination} ] && [ "$(readlink ${destination})" = ${source} ]; fi`
    : `[ -L ${destination} ] && [ "$(readlink ${destination})" = ${source} ] && rm ${destination}`;
  return new Promise(resolve => {
    const child = spawn('osascript', ['-e', `do shell script ${JSON.stringify(script)} with administrator privileges`], { stdio: 'ignore' });
    child.once('error', () => resolve(false));
    child.once('close', code => resolve(code === 0));
  });
}

const appImageHeader = '#!/bin/sh\n# Vhostra-owned AppImage CLI\n';
export function installAppImageCli(image: string, link: string): LinkResult {
  try {
    const entry = lstatSync(link);
    if (!entry.isFile() || !readFileSync(link, 'utf8').startsWith(appImageHeader)) return 'conflict';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const script = `${appImageHeader}ELECTRON_RUN_AS_NODE=1 exec ${shellQuote(image)} -e 'process.argv=[process.execPath,"vhostra",...process.argv.slice(1)];import(process.env.APPDIR+"/resources/app.asar/scripts/vhostra.mjs")' -- "$@"\n`;
  mkdirSync(path.dirname(link), { recursive: true });
  writeFileSync(link, script, { mode: 0o755 });
  return 'linked';
}

export function removeAppImageCli(link: string): boolean {
  try {
    if (!lstatSync(link).isFile() || !readFileSync(link, 'utf8').startsWith(appImageHeader)) return false;
    unlinkSync(link); return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
