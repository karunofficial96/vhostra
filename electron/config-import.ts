import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { VirtualHost, WebServer } from './store.js'

export type SourceServer = WebServer | 'litespeed-enterprise'
export interface ImportedHost {
  hostname: string; aliases: string[]; documentRoot: string; https: { enabled: boolean }; rewriteEnabled: boolean; indexFiles: string[]
}
export interface NativeImportPreview {
  source: string; server: SourceServer; status: 'Converted' | 'Converted with warnings' | 'Requires review' | 'Invalid'
  hosts: ImportedHost[]; warnings: string[]; preservedDirectives: string[]; sourceText: string
}
interface Block { name: string; args: string[]; children: Block[] }
function stripComments(source: string) {
  let output = ''; let quote = ''; let comment = false; let escaped = false
  for (const character of source) {
    if (comment) { if (character === '\n') { comment = false; output += character } continue }
    if (escaped) { output += character; escaped = false; continue }
    if (character === '\\') { output += character; escaped = true; continue }
    if (quote) { output += character; if (character === quote) quote = ''; continue }
    if (character === '"' || character === "'") { quote = character; output += character; continue }
    if (character === '#') { comment = true; continue }
    output += character
  }
  if (quote) throw new Error('Unclosed quoted configuration value.')
  return output
}
const tokens = (source: string) => source.match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[{};]|[^\s{};]+/g) ?? []
const unquote = (value: string) => value.replace(/^(['"])(.*)\1$/, '$2')
/** Bounded structural parser: never resolves includes, executes variables or reads referenced private files. */
function blocks(source: string, nginx: boolean): Block[] {
  // Preserve newlines as statement boundaries for LiteSpeed's non-semicolon syntax.
  const input = nginx ? source : source.replace(/\r?\n/g, ';\n')
  const list = tokens(input); let cursor = 0; let count = 0
  const parse = (depth: number): Block[] => {
    if (depth > 32) throw new Error('Configuration nesting exceeds the safe import limit.')
    const result: Block[] = []
    while (cursor < list.length) {
      const word = list[cursor++]
      if (word === '}') { if (!depth) throw new Error('Unexpected closing brace.'); return result }
      if (word === ';') continue
      if (word === '{') throw new Error('Unexpected opening brace.')
      if (++count > 20000) throw new Error('Too many configuration directives.')
      const node: Block = { name: word.toLowerCase(), args: [], children: [] }
      while (cursor < list.length && ![';', '{', '}'].includes(list[cursor])) node.args.push(unquote(list[cursor++]))
      if (list[cursor] === '{') { cursor++; node.children = parse(depth + 1) }
      else if (list[cursor] === ';') cursor++
      else if (nginx) throw new Error(`Missing semicolon after ${node.name}.`)
      result.push(node)
    }
    if (depth) throw new Error('Unclosed configuration block.')
    return result
  }
  return parse(0)
}
const walk = (nodes: Block[]): Block[] => nodes.flatMap(node => [node, ...walk(node.children)])
const first = (nodes: Block[], name: string) => nodes.find(node => node.name === name)?.args ?? []
const hostPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i
export function parseNativeConfiguration(sourceText: string, source: string, hint?: SourceServer): NativeImportPreview {
  if (Buffer.byteLength(sourceText) > 1024 * 1024 || sourceText.includes('\0')) throw new Error('Import requires a text configuration no larger than 1 MiB.')
  let clean: string
  try { clean = stripComments(sourceText) } catch (error) {
    if (!hint) throw error
    return { source, server: hint, status: 'Invalid', hosts: [], warnings: [error instanceof Error ? error.message : String(error)], preservedDirectives: [sourceText], sourceText }
  }
  const detected: SourceServer[] = []
  if (/<VirtualHost\s/i.test(clean)) detected.push('apache')
  if (/\bserver\s*\{/.test(clean) && /\bserver_name\b/.test(clean)) detected.push('nginx')
  if (/\b(?:docRoot|vhDomain)\b/i.test(clean) || /(?:^|\n)\s*virtualHost\s+[^\n{}]+\s*\{/i.test(clean)) detected.push('openlitespeed')
  const server = hint ?? (detected.length === 1 ? detected[0] : undefined)
  if (!server || !['apache', 'nginx', 'openlitespeed', 'litespeed-enterprise'].includes(server)) throw new Error('Source format is ambiguous. Choose Apache, Nginx, OpenLiteSpeed or LiteSpeed Enterprise.')
  const warnings: string[] = []; const preservedDirectives: string[] = []; const hosts: ImportedHost[] = []
  const preserve = (text: string) => { if (!preservedDirectives.includes(text)) preservedDirectives.push(text) }
  const add = (names: string[], root: string, tls: boolean, rewrite: boolean, indexes: string[]) => {
    names = [...new Set(names.map(name => name.toLowerCase()))]
    if (!names.length || names.some(name => !hostPattern.test(name) || name === 'localhost')) throw new Error('Each imported site needs an explicit valid hostname; wildcards and localhost require manual review.')
    if (!path.isAbsolute(root) || /[\r\n\0]/.test(root) || /[$%]/.test(root)) throw new Error('Document root must be an absolute host path without unresolved variables. Edit the source copy or choose a resolved document root.')
    if (indexes.length > 16 || indexes.some(index => !/^[a-zA-Z0-9_.-]+$/.test(index))) throw new Error('Unsupported index filename.')
    const existing = hosts.find(host => host.hostname === names[0])
    if (existing) {
      if (existing.documentRoot !== root || JSON.stringify(existing.aliases) !== JSON.stringify(names.slice(1))) throw new Error('Repeated hostname has conflicting roots or aliases.')
      existing.https.enabled ||= tls; return
    }
    if (hosts.length >= 64) throw new Error('Import is limited to 64 virtual hosts per operation.');
    hosts.push({ hostname: names[0], aliases: names.slice(1), documentRoot: root, https: { enabled: tls }, rewriteEnabled: rewrite, indexFiles: indexes.length ? indexes : ['index.php', 'index.html'] })
  }
  try {
    if (server === 'apache' || (server === 'litespeed-enterprise' && /<VirtualHost\s/i.test(clean))) {
      const matches = [...clean.matchAll(/<VirtualHost\s+([^>]+)>([\s\S]*?)<\/VirtualHost\s*>/gi)]
      if (!matches.length || (clean.match(/<VirtualHost\b/gi)?.length ?? 0) !== matches.length) throw new Error('Missing or unclosed Apache VirtualHost block.')
      for (const match of matches) {
        const lines = match[2].split(/\r?\n/).map(line => line.trim()).filter(Boolean)
        const values = (name: string) => lines.filter(line => new RegExp(`^${name}\\s`, 'i').test(line)).flatMap(line => tokens(line).slice(1).map(unquote))
        add([...values('ServerName'), ...values('ServerAlias')], values('DocumentRoot')[0] ?? '', /:443\b/.test(match[1]) || values('SSLEngine')[0]?.toLowerCase() === 'on', values('RewriteEngine')[0]?.toLowerCase() !== 'off', values('DirectoryIndex'))
        for (const line of lines) if (!/^(ServerName|ServerAlias|DocumentRoot|DirectoryIndex|RewriteEngine)\s/i.test(line)) preserve(line)
      }
      const global = clean.replace(/<VirtualHost\s+[^>]+>[\s\S]*?<\/VirtualHost\s*>/gi, '').trim()
      if (global) preserve(global)
    } else {
      const tree = blocks(clean, server === 'nginx'); const all = walk(tree)
      if (server === 'nginx') {
        for (const node of all.filter(node => node.name === 'server' && node.children.length)) {
          const flat = walk(node.children); const tries = flat.filter(item => item.name === 'try_files')
          const rewrite = tries.some(item => item.args.join(' ') === '$uri $uri/ /index.php?$query_string')
          add(first(node.children, 'server_name'), first(node.children, 'root')[0] ?? '', flat.some(item => item.name === 'listen' && item.args.some(arg => arg === 'ssl' || /(?:^|:)443$/.test(arg))), rewrite, first(node.children, 'index'))
          for (const item of flat) if (!['server_name', 'root', 'index'].includes(item.name) && !(item.name === 'try_files' && rewrite)) preserve(`${item.name} ${item.args.join(' ')}${item.children.length ? ' { … }' : ';'}`)
        }
        for (const node of tree.filter(node => node.name !== 'server' && !walk(node.children).some(item => item.name === 'server'))) preserve(`${node.name} ${node.args.join(' ')}`)
      } else {
        // A vhconf or inline virtualHost; external configFile/include references stay preserved.
        const inline = all.filter(node => node.name === 'virtualhost' && walk(node.children).some(item => item.name === 'docroot'))
        const sites = inline.length ? inline : [{ name: 'vhconf', args: [], children: tree }]
        for (const node of sites) {
          const flat = walk(node.children); const root = first(flat, 'docroot')[0]
          if (!root) continue
          const domain = first(flat, 'vhdomain').join(',') || node.args[0]
          const aliases = first(flat, 'vhaliases').join(',')
          const names = `${domain ?? ''},${aliases}`.split(/[\s,]+/).filter(Boolean)
          add(names, root, false, first(flat, 'enable')[0] !== '0', first(flat, 'indexfiles').join(',').split(',').filter(Boolean))
        }
        for (const item of all) if (!['docroot', 'vhdomain', 'vhaliases', 'indexfiles', 'index', 'virtualhost'].includes(item.name)) preserve(`${item.name} ${item.args.join(' ')}${item.children.length ? ' { … }' : ''}`)
        warnings.push('LiteSpeed listener mappings, external configFile/includes, handlers and proprietary/global directives require review. Referenced files are never read automatically.')
      }
    }
    if (server === 'litespeed-enterprise') warnings.push('Enterprise import is limited to compatible text virtual-host syntax. Proprietary XML, license and server-global features are not converted.');
    if (!hosts.length) throw new Error('No self-contained virtual host with a domain and document root was found. Import its resolved vhconf file or an inline definition.')
    if (Buffer.byteLength(sourceText) * hosts.length > 4 * 1024 * 1024) throw new Error('Preserved canonical source would exceed the 4 MiB import budget. Split the virtual-host definitions into smaller files.');
    const names = hosts.flatMap(host => [host.hostname, ...host.aliases])
    if (new Set(names).size !== names.length) throw new Error('Imported virtual hosts have conflicting hostnames or aliases.')
    if (hosts.some(host => host.rewriteEnabled)) warnings.push('Managed rewrite intent uses Vhostra defaults. Existing .htaccess stays in the site directory for Apache/OLS; custom rules and access policies are not translated across servers.');
    if (preservedDirectives.length) warnings.push('Preserved source directives are inactive. Review access restrictions, redirects, custom rewrites, TLS and PHP settings before importing; Vhostra uses its own ports, certificates and selected PHP runtime.')
    return { source, server, hosts, warnings, preservedDirectives, sourceText, status: preservedDirectives.length ? 'Requires review' : warnings.length ? 'Converted with warnings' : 'Converted' }
  } catch (error) {
    return { source, server, hosts: [], warnings: [...warnings, error instanceof Error ? error.message : String(error)], preservedDirectives: [sourceText], sourceText, status: 'Invalid' }
  }
}
export async function readNativeConfiguration(source: string, hint?: SourceServer): Promise<NativeImportPreview> {
  const stat = await fs.lstat(source)
  if (stat.isSymbolicLink()) throw new Error('Choose the actual source configuration file or directory, rather than a symbolic link.')
  if (stat.isDirectory()) return readLiteSpeedDirectory(source, hint)
  if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('Select a text configuration file no larger than 1 MiB.')
  return parseNativeConfiguration(await fs.readFile(source, 'utf8'), source, hint)
}
/** Explicit directory import reads only bounded regular .conf files inside the selected tree. */
async function readLiteSpeedDirectory(directory: string, hint?: SourceServer): Promise<NativeImportPreview> {
  if (hint && !['openlitespeed', 'litespeed-enterprise'].includes(hint)) throw new Error('Directory imports support LiteSpeed configuration trees. Choose a .conf file for Apache or Nginx.')
  const files: Array<{ file: string; text: string }> = []; let total = 0
  const read = async (root: string, depth: number): Promise<void> => {
    if (depth > 5) return
    for (const item of await fs.readdir(root, { withFileTypes: true })) {
      if (item.isSymbolicLink()) continue
      const file = path.join(root, item.name)
      if (item.isDirectory()) await read(file, depth + 1)
      else if (item.isFile() && item.name.endsWith('.conf')) {
        const stat = await fs.stat(file); total += stat.size
        if (files.length >= 64 || total > 2 * 1024 * 1024 || stat.size > 1024 * 1024) throw new Error('LiteSpeed tree exceeds the bounded import size (64 configs / 2 MiB). Choose a smaller configuration directory.')
        files.push({ file, text: await fs.readFile(file, 'utf8') })
      }
    }
  }
  await read(directory, 0)
  const main = files.find(item => path.basename(item.file) === 'httpd_config.conf')
  const server = hint ?? 'openlitespeed'
  if (!main) throw new Error('Choose a LiteSpeed configuration directory containing httpd_config.conf, or import a self-contained vhconf file.')
  const all = walk(blocks(stripComments(main.text), false))
  const mapped = all.filter(node => node.name === 'map')
  const hosts: ImportedHost[] = []; const warnings: string[] = []; const preservedDirectives: string[] = []
  for (const node of all.filter(node => node.name === 'virtualhost')) {
    const name = node.args[0]; const flat = walk(node.children)
    const configFile = first(flat, 'configfile')[0]
    if (!configFile) { warnings.push(`Virtual host ${name}: missing configFile; preserved for review.`); continue }
    const vhRoot = first(flat, 'vhroot')[0] ?? ''
    const resolvedReference = configFile.replace(/\$VH_ROOT/gi, vhRoot).replace(/\$SERVER_ROOT\/conf\//gi, '').replace(/\$SERVER_ROOT\//gi, '')
    const match = files.find(item => path.relative(directory, item.file) === resolvedReference || item.file === path.resolve(directory, resolvedReference))
    if (!match) { warnings.push(`Virtual host ${name}: configFile is outside the selected tree or unavailable; not read.`); continue }
    const domains = mapped.filter(item => item.args[0] === name).flatMap(item => item.args.slice(1).join(',').split(/[\s,]+/)).filter(Boolean)
    let text = match.text.replace(/\$VH_ROOT/gi, vhRoot)
    if (domains.length && !/\bvhDomain\s/i.test(text)) text += `\nvhDomain ${domains[0]}\nvhAliases ${domains.slice(1).join(',')}\n`
    const preview = parseNativeConfiguration(text, match.file, server)
    if (preview.status === 'Invalid') warnings.push(...preview.warnings.map(warning => `${name}: ${warning}`))
    else hosts.push(...preview.hosts)
    preservedDirectives.push(...preview.preservedDirectives)
  }
  if (total * hosts.length > 4 * 1024 * 1024) throw new Error('Preserved canonical source would exceed the 4 MiB import budget. Choose a smaller LiteSpeed tree or import individual vhconf files.');
  const names = hosts.flatMap(host => [host.hostname, ...host.aliases])
  if (new Set(names).size !== names.length) throw new Error('Directory import has conflicting domains or aliases.')
  return { source: directory, server, hosts, warnings: [...warnings, 'Only resolved domains and host document roots are converted. Listener ports, TLS, access rules, handlers and server-global configuration remain inactive and require review.'], status: hosts.length ? 'Requires review' : 'Invalid', preservedDirectives: [main.text, ...preservedDirectives], sourceText: files.sort((a, b) => a.file.localeCompare(b.file)).map(item => `# Source: ${item.file}\n${item.text}`).join('\n') }
}
export function importedMetadata(preview: NativeImportPreview): Pick<VirtualHost, 'source' | 'preservedDirectives'> {
  return { source: { server: preview.server, path: preview.source, importedAt: new Date().toISOString(), raw: preview.sourceText, status: preview.status, warnings: preview.warnings }, preservedDirectives: preview.preservedDirectives }
}
