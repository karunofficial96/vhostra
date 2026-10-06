import { hostsDiff } from './hosts-diff.js'
import { authorizeProtectedTransaction } from './protected-launcher.js'
import { createHash, randomUUID } from 'node:crypto'
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

export interface HostsEditReview {
  id: string
  contents: string
  diff: string
  removedLines: number
  addedLines: number
  truncated: boolean
  managedChanges: string[]
  mappingChanges: { added: number; removed: number; modified: number; manual: number }; commentsChanged: number
}
const digest = (text: string) => createHash('sha256').update(text).digest('hex')
const managedLines = (contents: string) => contents.split(/\r?\n/).flatMap((text, index) => ownedRecord.test(text) ? [{ line: index + 1, text, hostnames: text.split('#')[0].trim().split(/\s+/).slice(1) }] : [])
const changedExternally = () => new Error('Hosts file changed externally. Reload the current file and review your edits again; no newer contents were overwritten.')

export class HostsFileManager {
  readonly hostsPath: string
  private readonly localFixture: boolean
  private platform: NodeJS.Platform = process.platform
  private execute = execute
  private issues = new Map<string, string>()
  private mutation: Promise<unknown> = Promise.resolve()
  private review: { id: string; source: string; proposed: string; expires: number } | undefined
  constructor(private readonly temporaryDirectory: string, private readonly recoveryDirectory = path.join(temporaryDirectory, 'hosts-backups'), hostsPath?: string) { this.hostsPath = hostsPath ?? systemHostsPath(); this.localFixture = hostsPath !== undefined }
  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const next = this.mutation.then(task, task)
    this.mutation = next.catch(() => undefined)
    return next
  }
  async inspect() { if ((await fs.stat(this.hostsPath)).size > 1024 * 1024) throw new Error('Hosts file exceeds the 1 MiB editor limit.'); const contents = await fs.readFile(this.hostsPath, 'utf8'); if (Buffer.byteLength(contents) > 1024 * 1024) throw new Error('Hosts file exceeds the 1 MiB editor limit.'); return { path: this.hostsPath, contents, managedLines: managedLines(contents) } }
  /** Recovery only prepares a reviewed buffer; the normal explicit Save elevates. */
  async previewPrevious(expected: string) {
    const records: Array<{ original: string; createdAt: string }> = []
    for (const entry of await fs.readdir(this.recoveryDirectory, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isFile() || !/^[a-f0-9-]{36}\.json$/i.test(entry.name)) continue
      try {
        const file = path.join(this.recoveryDirectory, entry.name)
        if ((await fs.stat(file)).size > 8 * 1024 * 1024) continue
        const record = JSON.parse(await fs.readFile(file, 'utf8'))
        if (record.owner === 'vhostra' && record.kind === 'hosts-recovery' && record.status === 'completed' && record.hostsPath === this.hostsPath && typeof record.original === 'string' && Number.isFinite(Date.parse(record.createdAt))) records.push(record)
      } catch { /* Invalid records are not recovery candidates. */ }
    }
    records.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    if (!records.length) throw new Error('No completed previous Hosts file backup is available.')
    return this.previewEdit(records[0].original, expected)
  }
  private validateEdit(contents: string, expected: string) {
    if (typeof contents !== 'string' || typeof expected !== 'string' || Buffer.byteLength(contents) > 1024 * 1024 || Buffer.byteLength(expected) > 1024 * 1024 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\r]/.test(contents.replace(/\r\n/g, '\n'))) throw new Error('Invalid Hosts content (1 MiB limit; no NUL or bare carriage returns).')
    if (contents.split('\n').length > 16384 || expected.split('\n').length > 16384) throw new Error('Hosts editor supports at most 16,384 lines.');
    if (expected.includes('\r\n') && !/(?<!\r)\n/.test(expected)) contents = contents.replace(/\r?\n/g, '\r\n')
    for (const [index, line] of contents.split(/\r?\n/).entries()) {
      const text = line.replace(/#.*/, '').trim(); if (!text) continue
      const [address, ...names] = text.split(/\s+/)
      if (!isIP(address) || !names.length || names.some(name => !hostnamePattern.test(name))) throw new Error(`Invalid Hosts entry on line ${index + 1}: use a valid IPv4/IPv6 address and hostname(s).`)
    }
    if (Buffer.byteLength(contents) > 1024 * 1024) throw new Error('Hosts file exceeds the 1 MiB editor limit.')
    return contents
  }
  previewEdit(contents: string, expected: string) { return this.serialize(async () => {
    contents = this.validateEdit(contents, expected)
    if ((await this.inspect()).contents !== expected) throw changedExternally()
    if (contents === expected) throw new Error('No Hosts changes to review.')
    const diff = hostsDiff(expected, contents)
    const oldEntries = parseHosts(expected); const newEntries = parseHosts(contents)
    const ownedNames = new Set([...managedLines(expected), ...managedLines(contents)].flatMap(line => line.hostnames.map(name => name.toLowerCase())))
    const mappingChanges = { added: 0, removed: 0, modified: 0, manual: 0 }
    for (const name of new Set([...oldEntries.keys(), ...newEntries.keys()])) {
      const old = oldEntries.get(name); const next = newEntries.get(name)
      if (JSON.stringify([...(old ?? [])].sort()) === JSON.stringify([...(next ?? [])].sort())) continue
      if (!old) mappingChanges.added++; else if (!next) mappingChanges.removed++; else mappingChanges.modified++
      if (!ownedNames.has(name)) mappingChanges.manual++
    }
    const comments = (text: string) => { const counts = new Map<string, number>(); for (const line of text.split(/\r?\n/)) if (line.includes('#')) { const comment = line.slice(line.indexOf('#')); counts.set(comment, (counts.get(comment) ?? 0) + 1) }; return counts }
    const beforeComments = comments(expected); const afterComments = comments(contents)
    const commentsChanged = [...new Set([...beforeComments.keys(), ...afterComments.keys()])].reduce((count, comment) => count + Math.abs((beforeComments.get(comment) ?? 0) - (afterComments.get(comment) ?? 0)), 0)
    const remaining = new Map<string, number>()
    for (const line of managedLines(contents)) remaining.set(line.text, (remaining.get(line.text) ?? 0) + 1)
    const managedChanges = managedLines(expected).filter(line => { const count = remaining.get(line.text) ?? 0; if (count) { remaining.set(line.text, count - 1); return false }; return true }).map(line => `Line ${line.line}: ${line.hostnames.join(', ')}`)
    const oldManaged = new Set(managedLines(expected).map(line => line.text))
    for (const line of managedLines(contents)) if (!oldManaged.has(line.text)) managedChanges.push(`Added line ${line.line}: ${line.hostnames.join(', ')}`)
    const id = randomUUID(); this.review = { id, source: digest(expected), proposed: digest(contents), expires: Date.now() + 10 * 60 * 1000 }
    return { id, contents, ...diff, managedChanges, mappingChanges, commentsChanged } satisfies HostsEditReview
  }) }
  /** Only the explicit full-file editor uses a reviewed, confirmed manual write. */
  edit(contents: string, expected: string, reviewId: string) { return this.serialize(async () => {
    contents = this.validateEdit(contents, expected)
    if ((await this.inspect()).contents !== expected) throw changedExternally()
    const review = this.review
    if (!review || review.id !== reviewId || review.expires < Date.now() || review.source !== digest(expected) || review.proposed !== digest(contents)) throw new Error('Review and explicitly confirm these Hosts changes before saving.')
    this.review = undefined
    await this.replaceWithElevation(contents, expected, 'manual')
    this.issues.clear()
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

  private async replaceWithElevation(contents: string, expectedSource: string, mode: 'automatic' | 'manual' = 'automatic') {
    if (mode === 'automatic') {
      // Automatic Site/repair/delete paths can only alter positively owned lines.
      const unrelated = (source: string) => source.split(/(?<=\n)/).filter(line => !ownedRecord.test(line.trimEnd())).join('')
      const before = unrelated(expectedSource); const after = unrelated(contents)
      // A missing final newline may need one separator before an owned append.
      if (after !== before && !(before && !before.endsWith('\n') && after === before + '\n')) throw new Error('Automatic Hosts management must preserve unrelated entries and comments, and may add only Vhostra-owned mappings.')
    }
    if ((await this.inspect()).contents !== expectedSource) throw changedExternally()
    await this.retainRecoverySnapshots().catch(() => undefined)
    const records = await fs.readdir(this.recoveryDirectory, { withFileTypes: true }).catch(() => [])
    if (records.filter(entry => entry.isFile() && /^[a-f0-9-]{36}\.json$/i.test(entry.name)).length >= 60) throw new Error('Hosts recovery storage has reached 60 records. Review retained failed recovery files before saving again; none were deleted.')
    const temporary = await this.writeTemporary(contents)
    const expected = await this.writeTemporary(expectedSource)
    const token = randomUUID()
    const staged = `${this.hostsPath}.vhostra-${token}.tmp`
    const backup = `${this.hostsPath}.vhostra-${token}.bak`
    const recoveryFile = path.join(this.recoveryDirectory, `${token}.json`)
    const recovery = { owner: 'vhostra', kind: 'hosts-recovery', status: 'active', mode, createdAt: new Date().toISOString(), hostsPath: this.hostsPath, original: expectedSource, nativeBackup: backup }
    try {
      await fs.mkdir(this.recoveryDirectory, { recursive: true, mode: 0o700 })
      await fs.writeFile(recoveryFile, JSON.stringify(recovery), { mode: 0o600 })
      if (this.platform === 'darwin' && !this.localFixture && this.hostsPath === systemHostsPath()) {
        await authorizeProtectedTransaction({ version: 1, operations: [{ type: 'hosts', expectedSha256: digest(expectedSource), contents }] })
      } else if (this.platform === 'win32') {
        // EncodedCommand avoids nested ArgumentList quoting; exit code belongs to
        // the elevated child, not merely the unelevated Start-Process launcher.
        const command = `$ErrorActionPreference='Stop'; $replaced=$false; try { $target=${powerShellString(this.hostsPath)}; if ([Convert]::ToBase64String([System.IO.File]::ReadAllBytes($target)) -cne [Convert]::ToBase64String([System.IO.File]::ReadAllBytes(${powerShellString(expected)}))) { throw 'Hosts file changed; retry repair' }; [System.IO.File]::Copy($target,${powerShellString(staged)},$false); [System.IO.File]::WriteAllBytes(${powerShellString(staged)},[System.IO.File]::ReadAllBytes(${powerShellString(temporary)})); if ([Convert]::ToBase64String([System.IO.File]::ReadAllBytes($target)) -cne [Convert]::ToBase64String([System.IO.File]::ReadAllBytes(${powerShellString(expected)}))) { throw 'Hosts file changed; retry repair' }; [System.IO.File]::Replace(${powerShellString(staged)},$target,${powerShellString(backup)}); $replaced=$true; if ([Convert]::ToBase64String([System.IO.File]::ReadAllBytes($target)) -cne [Convert]::ToBase64String([System.IO.File]::ReadAllBytes(${powerShellString(temporary)}))) { throw 'Hosts write verification failed; native backup retained' }; Remove-Item ${powerShellString(backup)} -Force; exit 0 } catch { $failure=$_; if ($replaced -and (Test-Path ${powerShellString(backup)})) { try { if ([Convert]::ToBase64String([System.IO.File]::ReadAllBytes($target)) -ceq [Convert]::ToBase64String([System.IO.File]::ReadAllBytes(${powerShellString(temporary)}))) { [System.IO.File]::Copy(${powerShellString(backup)},${powerShellString(staged)},$true); if ([Convert]::ToBase64String([System.IO.File]::ReadAllBytes($target)) -ceq [Convert]::ToBase64String([System.IO.File]::ReadAllBytes(${powerShellString(temporary)}))) { [System.IO.File]::Replace(${powerShellString(staged)},$target,$null); if ([Convert]::ToBase64String([System.IO.File]::ReadAllBytes($target)) -cne [Convert]::ToBase64String([System.IO.File]::ReadAllBytes(${powerShellString(expected)}))) { throw 'Hosts recovery verification failed; backup retained' } } } } catch { Write-Warning 'Recovery failed; backup retained' } }; Write-Error $failure; exit 1 } finally { if (Test-Path ${powerShellString(staged)}) { Remove-Item ${powerShellString(staged)} -Force } }`
        const encoded = Buffer.from(command, 'utf16le').toString('base64')
        await this.execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference='Stop'; $child=Start-Process powershell.exe -Verb RunAs -Wait -PassThru -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','${encoded}'; exit $child.ExitCode`])
      } else {
        const target = shellQuote(this.hostsPath)
        const stage = shellQuote(staged)
        // Exclusive lock serializes Vhostra writers across processes. Compare again
        // after preparing a metadata-preserving sibling, then rename atomically.
        const lock = shellQuote(`${this.hostsPath}.vhostra-lock`)
        const command = `set -eu; mkdir ${lock} || exit 1; written=0; cleanup() { result=$?; trap - EXIT; if [ "$result" -ne 0 ] && [ "$written" -eq 1 ] && cmp -s ${shellQuote(temporary)} ${target}; then if cp -p ${shellQuote(backup)} ${stage} && cmp -s ${shellQuote(temporary)} ${target} && mv -f ${stage} ${target} && cmp -s ${shellQuote(expected)} ${target}; then echo "Hosts write failed; original restored" >&2; else echo "Hosts recovery needs review; backup retained" >&2; fi; fi; rm -f ${stage}; rmdir ${lock}; exit "$result"; }; trap cleanup EXIT; cmp -s ${shellQuote(expected)} ${target} || { echo "Hosts file changed externally; reload and review" >&2; exit 1; }; cp -p ${target} ${shellQuote(backup)}; cp -p ${target} ${stage}; cat ${shellQuote(temporary)} > ${stage}; cmp -s ${shellQuote(expected)} ${target} || { echo "Hosts file changed externally; reload and review" >&2; exit 1; }; mv -f ${stage} ${target}; written=1; cmp -s ${shellQuote(temporary)} ${target} || { echo "Hosts write verification failed; backup retained for review" >&2; exit 1; }; rm -f ${shellQuote(backup)}`
        if (this.localFixture) await this.execute('/bin/sh', ['-c', command])
        else if (this.platform === 'darwin') await this.execute('osascript', ['-e', `do shell script ${appleScriptString(command)} with administrator privileges`])
        else await this.execute('pkexec', ['/bin/sh', '-c', command])
      }
      if (await fs.readFile(this.hostsPath, 'utf8') !== contents) throw new Error('The protected hosts-file write could not be verified; retry repair.')
      recovery.status = 'completed'; await fs.writeFile(recoveryFile, JSON.stringify(recovery), { mode: 0o600 }).catch(() => undefined)
      await this.retainRecoverySnapshots().catch(() => undefined)
    } catch (error) {
      let unchanged = false
      try { unchanged = await fs.readFile(this.hostsPath, 'utf8') === expectedSource && !(await fs.lstat(backup).catch(() => null)) } catch { /* Keep recovery when its outcome cannot be established. */ }
      if (unchanged) await fs.rm(recoveryFile, { force: true }).catch(() => undefined)
      else { recovery.status = 'failed'; await fs.writeFile(recoveryFile, JSON.stringify(recovery), { mode: 0o600 }).catch(() => undefined) }
      throw new Error(`Hosts write was not confirmed. Administrator approval was cancelled, the protected write failed, or the file changed externally while approval was pending. Reload and review before retrying. ${unchanged ? 'Original file is unchanged; no recovery is needed.' : `Recovery backup: ${recoveryFile}.`} ${errorMessage(error)}`)
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
