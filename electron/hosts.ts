import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { isIP } from 'node:net'
import { spawn } from 'node:child_process'

export interface HostsOperation {
  installed: string[]
  alreadyMapped: string[]
  conflicts: Array<{ hostname: string; address: string }>
  message: string
}

const ownedRecord = /^(?:127\.0\.0\.1|::1)\s+[^#]+#\s*Vhostra\s+[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\s*$/i
const hostnamePattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i
const systemHostsPath = () => process.platform === 'win32'
  ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts')
  : '/etc/hosts'

export class HostsFileManager {
  readonly hostsPath = systemHostsPath()
  private platform: NodeJS.Platform = process.platform
  private execute = execute
  private issues = new Map<string, string>()
  private mutation: Promise<unknown> = Promise.resolve()
  constructor(private readonly temporaryDirectory: string, private readonly recoveryDirectory = path.join(temporaryDirectory, 'hosts-backups')) {}
  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const next = this.mutation.then(task, task)
    this.mutation = next.catch(() => undefined)
    return next
  }
  async inspect() { if ((await fs.stat(this.hostsPath)).size > 1024 * 1024) throw new Error('Hosts file exceeds the 1 MiB editor limit.'); const contents = await fs.readFile(this.hostsPath, 'utf8'); if (Buffer.byteLength(contents) > 1024 * 1024) throw new Error('Hosts file exceeds the 1 MiB editor limit.'); return { path: this.hostsPath, contents } }
  edit(contents: string, expected: string) { return this.serialize(async () => {
    if (expected.includes('\r\n') && !/(?<!\r)\n/.test(expected)) contents = contents.replace(/\r?\n/g, '\r\n')
    if (typeof contents !== 'string' || typeof expected !== 'string' || Buffer.byteLength(contents) > 1024 * 1024 || contents.includes('\0')) throw new Error('Invalid Hosts content.')
    for (const line of contents.split(/\r?\n/)) {
      const text = line.replace(/#.*/, '').trim(); if (!text) continue
      const [address, ...names] = text.split(/\s+/)
      if (!isIP(address) || !names.length || names.some(name => !hostnamePattern.test(name))) throw new Error(`Invalid Hosts entry: ${text}`)
    }
    // Manual editing is explicit. Preserve unrelated records/comments byte-for-byte
    // in their original order; only marked Vhostra records may be removed/changed.
    const unrelated = expected.split(/(?<=\n)/).filter(line => !ownedRecord.test(line.trimEnd()))
    const remaining = [...contents.split(/(?<=\n)/)]; let cursor = 0
    for (const line of unrelated) { const index = remaining.findIndex((candidate, index) => index >= cursor && (candidate === line || (!line.endsWith('\n') && candidate.replace(/\r?\n$/, '') === line))); if (index < 0) throw new Error('Unrelated Hosts entries and comments must remain unchanged. Edit only Vhostra-owned lines or append new entries.'); cursor = index + 1 }
    if (contents !== expected) await this.replaceWithElevation(contents, expected)
    return this.inspect()
  }) }
  ensureLocalhostMappings(hostnames: string[]) { return this.serialize(() => this.withMappingFeedback(hostnames, () => this.ensureMappings(hostnames))) }
  private async withMappingFeedback<T>(names: string[], task: () => Promise<T>): Promise<T> {
    try { const result = await task(); names.forEach(name => this.issues.delete(name.toLowerCase())); return result }
    catch (error) {
      const message = errorMessage(error)
      const status = /cancel|1223|126|\(-128\)/i.test(message) ? 'Permission cancelled / mapping required' : /permission|EACCES|EPERM|authorization/i.test(message) ? 'Permission required / mapping required' : 'Failed / mapping required'
      names.forEach(name => this.issues.set(name.toLowerCase(), status))
      throw error
    }
  }
  reconcileMappings(hostnames: string[]) { return this.serialize(() => this.withMappingFeedback(hostnames, () => this.reconcile(hostnames))) }
  removeVhostraMappings(hostnames: string[]) { return this.serialize(() => this.removeMappings(hostnames)) }


  private async ensureMappings(hostnames: string[]): Promise<HostsOperation> {
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
      const conflicting = [...addresses].find(address => !['127.0.0.1', '::1'].includes(address))
      if (conflicting) conflicts.push({ hostname, address: conflicting })
      else if (addresses.has('127.0.0.1')) alreadyMapped.push(hostname)
      else missing.push(hostname)
    }
    if (conflicts.length) return { installed: [], alreadyMapped, conflicts, message: `Vhostra did not change ${this.hostsPath}: ${conflicts.map(conflict => `${conflict.hostname} already maps to ${conflict.address}`).join(', ')}.` }
    if (!missing.length) return { installed: [], alreadyMapped, conflicts: [], message: 'All local hostnames are already mapped to 127.0.0.1.' }
    const line = `127.0.0.1 ${missing.join(' ')} # Vhostra ${randomUUID()}\n`
    await this.replaceWithElevation(`${source}${source && !source.endsWith("\n") ? "\n" : ""}${line}`, source)
    return { installed: missing, alreadyMapped, conflicts: [], message: `Added Vhostra local mapping${missing.length === 1 ? '' : 's'} for ${missing.join(', ')}.` }
  }

  private async reconcile(hostnames: string[]) {
    const desired = new Set(hostnames.map(name => name.toLowerCase()).filter(name => name !== 'localhost'))
    const source = await fs.readFile(this.hostsPath, 'utf8')
    const stale = source.split(/\r?\n/).filter(line => ownedRecord.test(line)).flatMap(line => line.split('#')[0].trim().split(/\s+/).slice(1)).filter(name => !desired.has(name.toLowerCase()))
    // Validate every requested name before removing anything.
    for (const name of desired) if (!hostnamePattern.test(name)) throw new Error(`Invalid hostname: ${name}`)
    const status = await this.mappingStatus([...desired])
    const conflicts = status.filter(item => item.state === 'conflict').map(item => ({ hostname: item.hostname, address: item.address! }))
    if (conflicts.length) return { installed: [], alreadyMapped: [], conflicts, message: 'Hosts repair found conflicting mappings; no entries were changed.' }
    const retained = removeOwnedRecords(source, new Set(stale.map(name => name.toLowerCase())))
    const entries = parseHosts(retained)
    const alreadyMapped = [...desired].filter(name => entries.get(name)?.has('127.0.0.1'))
    const missing = [...desired].filter(name => !alreadyMapped.includes(name))
    const line = missing.length ? `127.0.0.1 ${missing.join(' ')} # Vhostra ${randomUUID()}\n` : ''
    const contents = `${retained}${line && retained && !retained.endsWith('\n') ? '\n' : ''}${line}`
    if (contents !== source) await this.replaceWithElevation(contents, source)
    return { installed: missing, alreadyMapped, conflicts: [], message: 'Verified all local mappings and removed obsolete Vhostra-owned records.' }
  }

  async mappingStatus(hostnames: string[]) {
    const entries = parseHosts(await fs.readFile(this.hostsPath, 'utf8'))
    return hostnames.map(hostname => {
      const addresses = entries.get(hostname.toLowerCase()) ?? new Set<string>()
      return { hostname, state: [...addresses].some(address => !['127.0.0.1', '::1'].includes(address)) ? 'conflict' as const : addresses.has('127.0.0.1') ? 'mapped' as const : 'required' as const, address: [...addresses].find(address => !['127.0.0.1', '::1'].includes(address)) ?? [...addresses][0], issue: this.issues.get(hostname.toLowerCase()) }
    })
  }

  /** Removes only lines that Vhostra itself marked; unrelated hosts entries stay intact. */
  private async removeMappings(hostnames: string[]) {
    const requested = new Set(hostnames.map(value => value.toLowerCase()))
    const source = await fs.readFile(this.hostsPath, 'utf8')
    const retained = removeOwnedRecords(source, requested)
    if (retained === source) return false
    await this.replaceWithElevation(retained, source)
    return true
  }

  private async replaceWithElevation(contents: string, expectedSource: string) {
    const temporary = await this.writeTemporary(contents)
    const expected = await this.writeTemporary(expectedSource)
    const token = randomUUID()
    const staged = `${this.hostsPath}.vhostra-${token}.tmp`
    const backup = `${this.hostsPath}.vhostra-${token}.bak`
    const recoveryFile = path.join(this.recoveryDirectory, `${token}.json`)
    const recovery = { owner: 'vhostra', kind: 'hosts-recovery', status: 'active', createdAt: new Date().toISOString(), hostsPath: this.hostsPath, original: expectedSource }
    try {
      await fs.mkdir(this.recoveryDirectory, { recursive: true })
      await fs.writeFile(recoveryFile, JSON.stringify(recovery), { mode: 0o600 })
      if (this.platform === 'win32') {
        // EncodedCommand avoids nested ArgumentList quoting; exit code belongs to
        // the elevated child, not merely the unelevated Start-Process launcher.
        const command = `$ErrorActionPreference='Stop'; try { $target=${powerShellString(this.hostsPath)}; if ([Convert]::ToBase64String([System.IO.File]::ReadAllBytes($target)) -cne [Convert]::ToBase64String([System.IO.File]::ReadAllBytes(${powerShellString(expected)}))) { throw 'Hosts file changed; retry repair' }; [System.IO.File]::Copy($target,${powerShellString(staged)},$false); [System.IO.File]::WriteAllBytes(${powerShellString(staged)},[System.IO.File]::ReadAllBytes(${powerShellString(temporary)})); if ([Convert]::ToBase64String([System.IO.File]::ReadAllBytes($target)) -cne [Convert]::ToBase64String([System.IO.File]::ReadAllBytes(${powerShellString(expected)}))) { throw 'Hosts file changed; retry repair' }; [System.IO.File]::Replace(${powerShellString(staged)},$target,${powerShellString(backup)}); if ([Convert]::ToBase64String([System.IO.File]::ReadAllBytes($target)) -cne [Convert]::ToBase64String([System.IO.File]::ReadAllBytes(${powerShellString(temporary)}))) { throw 'Hosts write verification failed; native backup retained' }; Remove-Item ${powerShellString(backup)} -Force; exit 0 } catch { Write-Error $_; exit 1 } finally { if (Test-Path ${powerShellString(staged)}) { Remove-Item ${powerShellString(staged)} -Force } }`
        const encoded = Buffer.from(command, 'utf16le').toString('base64')
        await this.execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference='Stop'; $child=Start-Process powershell.exe -Verb RunAs -Wait -PassThru -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','${encoded}'; exit $child.ExitCode`])
      } else {
        const target = shellQuote(this.hostsPath)
        const stage = shellQuote(staged)
        // Exclusive lock serializes Vhostra writers across processes. Compare again
        // after preparing a metadata-preserving sibling, then rename atomically.
        const lock = shellQuote(`${this.hostsPath}.vhostra-lock`)
        const command = `set -eu; mkdir ${lock} || exit 1; cleanup() { rm -f ${stage}; rmdir ${lock}; }; trap cleanup EXIT; cmp -s ${shellQuote(expected)} ${target}; cp -p ${target} ${shellQuote(backup)}; cp -p ${target} ${stage}; cat ${shellQuote(temporary)} > ${stage}; cmp -s ${shellQuote(expected)} ${target}; mv -f ${stage} ${target}; cmp -s ${shellQuote(temporary)} ${target}; rm -f ${shellQuote(backup)}`
        if (this.platform === 'darwin') await this.execute('osascript', ['-e', `do shell script ${appleScriptString(command)} with administrator privileges`])
        else await this.execute('pkexec', ['/bin/sh', '-c', command])
      }
      if (await fs.readFile(this.hostsPath, 'utf8') !== contents) throw new Error('The protected hosts-file write could not be verified; retry repair.')
      recovery.status = 'completed'; await fs.writeFile(recoveryFile, JSON.stringify(recovery), { mode: 0o600 }).catch(() => undefined)
      await this.retainRecoverySnapshots().catch(() => undefined)
    } catch (error) {
      throw new Error(`Hosts mapping requires attention. Administrator approval or the protected write failed, or the file changed while approval was pending. No mapping success was claimed. ${errorMessage(error)}`)
    } finally { await Promise.all([temporary, expected].map(file => fs.rm(file, { force: true }))) }
  }

  private async retainRecoverySnapshots() {
    const completed: Array<{ file: string; createdAt: string }> = []
    for (const entry of await fs.readdir(this.recoveryDirectory, { withFileTypes: true })) {
      if (!entry.isFile() || !/^[a-f0-9-]{36}\.json$/i.test(entry.name)) continue
      const file = path.join(this.recoveryDirectory, entry.name)
      try {
        const record = JSON.parse(await fs.readFile(file, 'utf8'))
        if (record.owner === 'vhostra' && record.kind === 'hosts-recovery' && record.status === 'completed' && record.hostsPath === this.hostsPath && Number.isFinite(Date.parse(record.createdAt))) completed.push({ file, createdAt: record.createdAt })
      } catch { /* Unknown/failed recovery files remain untouched. */ }
    }
    completed.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    for (const snapshot of completed.slice(10)) await fs.unlink(snapshot.file)
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
  let error = ''; child.stderr.on('data', chunk => { error = (error + String(chunk)).slice(-16000) })
  child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(error.trim() || `${command} exited with ${code}`)))
})
export const shellQuote = (value: string) => `'${value.replaceAll("'", "'\"'\"'")}'`
const appleScriptString = (value: string) => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
const powerShellString = (value: string) => `'${value.replaceAll("'", "''")}'`
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Administrator authorization was cancelled or unavailable.'

export function removeOwnedRecords(source: string, requested: Set<string>) {
  return source.split(/(?<=\n)/).flatMap(raw => {
      const ending = raw.endsWith("\r\n") ? "\r\n" : raw.endsWith("\n") ? "\n" : ""
      const line = raw.slice(0, raw.length - ending.length)
      if (!ownedRecord.test(line)) return [raw]
      const [entry, comment = ''] = line.split(/#(.*)/s)
      const tokens = entry.trim().split(/\s+/).filter(Boolean)
      if (tokens.length < 2) return [raw]
      const [address, ...names] = tokens
      const keep = names.filter(hostname => !requested.has(hostname.toLowerCase()))
      if (keep.length === names.length) return [raw]
      // The marker stays with any aliases that originated on this Vhostra line.
      return keep.length ? [`${address} ${keep.join(' ')} #${comment.trim()}${ending}`] : []
    }).join('')
}
