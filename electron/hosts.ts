import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

export interface HostsOperation {
  installed: string[]
  alreadyMapped: string[]
  conflicts: Array<{ hostname: string; address: string }>
  message: string
}

const hostnamePattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i
const systemHostsPath = () => process.platform === 'win32'
  ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts')
  : '/etc/hosts'

export class HostsFileManager {
  readonly hostsPath = systemHostsPath()
  constructor(private readonly temporaryDirectory: string) {}

  async ensureLocalhostMappings(hostnames: string[]): Promise<HostsOperation> {
    const requested = [...new Set(hostnames.map(value => value.trim().toLowerCase()).filter(Boolean))]
    if (!requested.length) return { installed: [], alreadyMapped: [], conflicts: [], message: 'No hostnames require a hosts-file mapping.' }
    for (const hostname of requested) {
      if (!hostnamePattern.test(hostname) || hostname === 'localhost') throw new Error(`“${hostname}” is not a valid local hostname.`)
    }
    const source = await fs.readFile(this.hostsPath, 'utf8')
    const entries = parseHosts(source)
    const alreadyMapped: string[] = []; const missing: string[] = []; const conflicts: Array<{ hostname: string; address: string }> = []
    for (const hostname of requested) {
      const addresses = entries.get(hostname) ?? new Set<string>()
      if (addresses.has('127.0.0.1')) alreadyMapped.push(hostname)
      else if (addresses.size) conflicts.push({ hostname, address: [...addresses][0] })
      else missing.push(hostname)
    }
    if (conflicts.length) return { installed: [], alreadyMapped, conflicts, message: `Vhostra did not change ${this.hostsPath}: ${conflicts.map(conflict => `${conflict.hostname} already maps to ${conflict.address}`).join(', ')}.` }
    if (!missing.length) return { installed: [], alreadyMapped, conflicts: [], message: 'All local hostnames are already mapped to 127.0.0.1.' }
    const line = `127.0.0.1 ${missing.join(' ')} # Vhostra ${randomUUID()}\n`
    await this.appendWithElevation(line)
    return { installed: missing, alreadyMapped, conflicts: [], message: `Added Vhostra local mapping${missing.length === 1 ? '' : 's'} for ${missing.join(', ')}.` }
  }

  /** Removes only lines that Vhostra itself marked; unrelated hosts entries stay intact. */
  async removeVhostraMappings(hostnames: string[]) {
    const requested = new Set(hostnames.map(value => value.toLowerCase()))
    const source = await fs.readFile(this.hostsPath, 'utf8')
    const retained = source.split(/\r?\n/).filter(line => {
      if (!/#\s*Vhostra\b/i.test(line)) return true
      const tokens = line.replace(/#.*/, '').trim().split(/\s+/)
      return !tokens.slice(1).some(hostname => requested.has(hostname.toLowerCase()))
    }).join(os.EOL)
    if (retained === source) return false
    await this.replaceWithElevation(`${retained.replace(/\n*$/, '')}${os.EOL}`)
    return true
  }

  private async appendWithElevation(line: string) {
    const temporary = await this.writeTemporary(line)
    try {
      if (process.platform === 'darwin') {
        await execute('osascript', ['-e', `do shell script ${appleScriptString(`/bin/cat ${shellQuote(temporary)} >> /etc/hosts`)} with administrator privileges`])
      } else if (process.platform === 'win32') {
        const command = `[System.IO.File]::AppendAllText(${powerShellString(this.hostsPath)}, [System.IO.File]::ReadAllText(${powerShellString(temporary)}))`
        await execute('powershell.exe', ['-NoProfile', '-Command', `Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList '-NoProfile','-Command',${powerShellString(command)}`])
      } else {
        await executeWithInput('pkexec', ['/usr/bin/tee', '-a', this.hostsPath], line)
      }
    } catch (error) { throw new Error(`Vhostra created the virtual-host definition but could not add its protected hosts-file mapping. ${errorMessage(error)}`) } finally { await fs.rm(temporary, { force: true }) }
  }

  private async replaceWithElevation(contents: string) {
    const temporary = await this.writeTemporary(contents)
    try {
      if (process.platform === 'darwin') await execute('osascript', ['-e', `do shell script ${appleScriptString(`/bin/cp ${shellQuote(temporary)} /etc/hosts && /bin/chmod 644 /etc/hosts`)} with administrator privileges`])
      else if (process.platform === 'win32') {
        const command = `[System.IO.File]::Copy(${powerShellString(temporary)}, ${powerShellString(this.hostsPath)}, $true)`
        await execute('powershell.exe', ['-NoProfile', '-Command', `Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList '-NoProfile','-Command',${powerShellString(command)}`])
      } else await execute('pkexec', ['/usr/bin/install', '-m', '644', temporary, this.hostsPath])
    } catch (error) { throw new Error(`Vhostra could not remove its protected hosts-file mapping. ${errorMessage(error)}`) } finally { await fs.rm(temporary, { force: true }) }
  }

  private async writeTemporary(contents: string) {
    await fs.mkdir(this.temporaryDirectory, { recursive: true })
    const file = path.join(this.temporaryDirectory, `hosts-${randomUUID()}.txt`)
    await fs.writeFile(file, contents, { mode: 0o600 })
    return file
  }
}

export function parseHosts(source: string) {
  const entries = new Map<string, Set<string>>()
  for (const rawLine of source.split(/\r?\n/)) {
    const tokens = rawLine.replace(/#.*/, '').trim().split(/\s+/)
    if (tokens.length < 2 || !tokens[0]) continue
    const [address, ...hostnames] = tokens
    for (const hostname of hostnames) {
      const normalized = hostname.toLowerCase()
      if (!entries.has(normalized)) entries.set(normalized, new Set())
      entries.get(normalized)!.add(address)
    }
  }
  return entries
}

const execute = (command: string, args: string[]) => new Promise<void>((resolve, reject) => {
  const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: false })
  let error = ''; child.stderr.on('data', chunk => { error += String(chunk) })
  child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(error.trim() || `${command} exited with ${code}`)))
})
const executeWithInput = (command: string, args: string[], input: string) => new Promise<void>((resolve, reject) => {
  const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: false })
  let error = ''; child.stderr.on('data', chunk => { error += String(chunk) }); child.stdin.end(input)
  child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(error.trim() || `${command} exited with ${code}`)))
})
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\\"'\\\"'")}'`
const appleScriptString = (value: string) => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
const powerShellString = (value: string) => `'${value.replaceAll("'", "''")}'`
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Administrator authorization was cancelled or unavailable.'
