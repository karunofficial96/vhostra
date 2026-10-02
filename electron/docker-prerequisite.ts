import { accessSync, constants, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export type DockerCheck = { state: 'ready' | 'missing' | 'stopped' | 'broken' | 'timeout'; executable?: string; detail?: string };
export function knownDockerLocations(platform: NodeJS.Platform = process.platform, environment: NodeJS.ProcessEnv = process.env): string[] {
  return platform === 'darwin'
    ? ['/usr/local/bin/docker', '/opt/homebrew/bin/docker', '/Applications/Docker.app/Contents/Resources/bin/docker', '/Applications/Docker.app/Contents/MacOS/docker']
    : platform === 'win32'
      ? [path.win32.join(environment.ProgramFiles || 'C:\\Program Files', 'Docker', 'Docker', 'resources', 'bin', 'docker.exe'), path.win32.join(environment.LOCALAPPDATA || 'C:\\Users\\Public\\AppData\\Local', 'Programs', 'DockerDesktop', 'resources', 'bin', 'docker.exe')]
      : ['/usr/bin/docker', '/usr/local/bin/docker', '/snap/bin/docker'];
}
const known = knownDockerLocations();

export function validDockerExecutable(file: string): boolean {
  try { if (!path.isAbsolute(file) || !statSync(file).isFile()) return false; accessSync(file, constants.X_OK); return true; } catch { return false; }
}

export function resolveDockerExecutable(profile?: string, search: { path?: string; known?: string[] } = {}): string | undefined {
  let chosen = '';
  if (profile) try { chosen = JSON.parse(readFileSync(path.join(profile, 'docker-executable.json'), 'utf8')).path; } catch { /* No selection. */ }
  const name = process.platform === 'win32' ? 'docker.exe' : 'docker';
  const candidates = [chosen, ...(search.path ?? process.env.PATH ?? '').split(path.delimiter).filter(Boolean).map(directory => path.join(directory, name)), ...(search.known ?? known)];
  return candidates.find(validDockerExecutable);
}

export function saveDockerExecutable(profile: string, file: string): void {
  if (!validDockerExecutable(file)) throw new Error('Choose the Docker executable.');
  writeFileSync(path.join(profile, 'docker-executable.json'), JSON.stringify({ path: file }), { mode: 0o600 });
}

export async function checkDocker(profile?: string, selected?: string, search?: { path?: string; known?: string[] }): Promise<DockerCheck> {
  const executable = selected || resolveDockerExecutable(profile, search);
  if (!executable) return { state: 'missing' };
  if (!validDockerExecutable(executable)) return { state: 'broken', detail: 'The selected Docker executable cannot be opened.' };
  const version = await runDockerProbe(executable, ['--version'], 3000);
  if (version.timeout) return { state: 'timeout', executable };
  if (version.code !== 0 || !/^Docker version \d+(?:\.\d+)+/i.test(version.stdout.trim()))
    return { state: 'broken', executable, detail: 'The selected file did not identify itself as Docker CLI.' };
  const daemon = await runDockerProbe(executable, ['info', '--format', '{{.ServerVersion}}'], 7000);
  if (daemon.timeout) return { state: 'timeout', executable };
  if (daemon.code === 0 && /^\d+(?:\.\d+)+/.test(daemon.stdout.trim())) return { state: 'ready', executable };
  if (/permission denied|access is denied/i.test(daemon.stderr)) return { state: 'broken', executable, detail: 'Docker cannot access its daemon. Check system permissions.' };
  if (/cannot connect|daemon|docker engine/i.test(daemon.stderr)) return { state: 'stopped', executable };
  return { state: 'broken', executable, detail: 'Docker returned an error. Open Docker for more information.' };
}

function runDockerProbe(executable: string, args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string; timeout: boolean }> {
  return new Promise(resolve => {
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let done = false;
    const finish = (code: number | null, timeout = false) => {
      if (done) return;
      done = true; clearTimeout(timer);
      resolve({ code, stdout, stderr, timeout });
    };
    const timer = setTimeout(() => { child.kill('SIGTERM'); const force = setTimeout(() => child.kill('SIGKILL'), 2000); force.unref(); finish(null, true); }, timeoutMs);
    child.stdout.on('data', chunk => { stdout = (stdout + String(chunk)).slice(0, 1024); });
    child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(0, 1024); });
    child.once('error', () => finish(null));
    child.once('close', code => finish(code));
  });
}

export function dockerMessage(check: DockerCheck): string {
  switch (check.state) {
    case 'ready': return 'Docker is ready.';
    case 'missing': return 'Docker was not found on this computer. Install Docker to run Vhostra services.';
    case 'stopped': return 'Docker is installed but is not running or cannot be reached.';
    case 'timeout': return 'Docker did not respond in time. Check Docker, then try again.';
    case 'broken': return 'Docker was found but could not be used. Choose a working Docker executable or repair Docker.';
  }
}

export function dockerInstallUrl(): string {
  return process.platform === 'darwin' ? 'https://docs.docker.com/desktop/setup/install/mac-install/'
    : process.platform === 'win32' ? 'https://docs.docker.com/desktop/setup/install/windows-install/'
      : 'https://docs.docker.com/engine/install/';
}

export function dockerDesktopApplication(): string | undefined {
  if (process.platform === 'darwin') return existsSync('/Applications/Docker.app') ? '/Applications/Docker.app' : undefined;
  if (process.platform === 'win32') {
    const file = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Docker', 'Docker', 'Docker Desktop.exe');
    return existsSync(file) ? file : undefined;
  }
  return undefined;
}
