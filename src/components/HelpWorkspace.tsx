import { useRef, useState, type KeyboardEvent } from 'react'

type Entry = { title: string; text: string; command?: string; output?: string }
type Topic = { title: string; intro: string[]; entries?: Entry[]; note?: string }

// Static content is created once at module load. Search scans this small local array only.
const topics: Topic[] = [
  { title: 'Getting Started', intro: [
    'Vhostra is a local web development app for websites on your computer. It is not a production hosting control panel. Keep Vhostra and its managed services on your own machine.',
    'On first launch, choose Set up as new or restore a Vhostra backup. Confirm the Local Configuration Path, where Vhostra keeps its settings, Site definitions, certificates, logs and database data. You can change this location later in Settings.',
    'Choose a theme, one web server (Apache, Nginx or OpenLiteSpeed), a supported PHP version, and optionally Redis or Memcached. Set Up Vhostra validates ports and prepares the runtime; Docker must be available.',
    'Start Services if they are stopped. In Sites, add a Site with an existing Root Directory or import a supported Site configuration. If the Site needs a database, create or import it separately in Databases. Then use Open Site to view it in your browser.'
  ] },
  { title: 'Services', intro: [
    'Start Services starts the local services Vhostra needs. Stop Services stops them; Restart Services stops and starts them again. The Services page also controls individual supported services. MariaDB can run separately from the web runtime.',
    'Not Created means Vhostra has not created the required runtime or container yet. Stopped means it exists but is not running. Starting, Stopping and Restarting describe work in progress. Running means the service is ready. Disabled means an optional service is off. Failed or Unhealthy means a real problem occurred; review its details and Logs. Unavailable usually means the local runtime cannot be reached.',
    'Only your selected web server runs: Apache, Nginx or OpenLiteSpeed. OpenLiteSpeed is a web server like the other two. Vhostra shows one Site configuration even when that server needs several internal config pieces. Vhostra does not run, install, bundle or require LiteSpeed Enterprise.'
  ] },
  { title: 'Sites', intro: [
    'Use Add Site for an existing project folder. Server Name is the local address, such as example.test. Aliases are extra names for the same Site. Root Directory is the existing folder containing the website files. Vhostra leaves those external files in place.',
    'Edit a Site to change its settings. Delete Site removes its Vhostra configuration, not the external website files. Open Site opens its local URL. The Dashboard preview is a saved snapshot of the page; Refresh Preview requests a new one when services and any expected database are ready.',
    'Adding or importing a Site does not import its database. For WordPress or any other database-backed app, open Databases and create or import the database separately. Set the app’s own database connection settings as needed.'
  ], entries: [
    { title: 'Import a Site', text: 'Sites can preview and import Vhostra Site JSON, Apache or Nginx vhost files, OpenLiteSpeed configuration, and supported LiteSpeed Enterprise text. Review any unsupported directives before applying. Enterprise configuration is converted for a supported Vhostra server; Enterprise is not a runtime option.' },
    { title: 'Export a Site', text: 'Export a selected Site to a local file for Vhostra and local development. Apache and Nginx use native configuration; the OpenLiteSpeed choice writes a portable Vhostra Site JSON file. Exporting does not change the running Site. This file is not automatically ready for production hosting. If you use it as a starting point elsewhere, review and edit paths, domains, ports, TLS certificates, permissions, logging, security and server-specific settings for that server. Export Database for Production is a separate SQL database workflow.' }
  ] },
  { title: 'Databases', intro: [
    'MariaDB stores data for local projects. In Databases, create a database and user, import an SQL file, export an SQL file, check or repair a database, or delete one after confirmation. Importing a Site configuration alone never imports SQL data.',
    'Database users can be created independently, granted access to databases, given a new password, or deleted. User@Host means a MariaDB account is identified by both the username and where the connection comes from. Use the displayed account when changing access.',
    'phpMyAdmin opens a local graphical database interface in your browser. It can be used for supported database, table, SQL import/export and account administration. Keep database passwords and exported SQL files private.'
  ], entries: [
    { title: 'Export Database for Production', text: 'Choose the database, production URL and expected production root, then save a local SQL dump. This does not deploy a Site. Generic application data is exported unchanged; update application-specific URLs and paths after deployment. Vhostra does not promise automatic WordPress-safe serialized-data conversion.' }
  ] },
  { title: 'PHP and caches', intro: [
    'Settings selects the PHP version for the one active web runtime. Switching versions may rebuild that runtime. In PHP, inspect available extensions, install or enable optional ones, and control OPcache, which keeps compiled PHP code in memory for faster repeat requests. Required extensions are protected.',
    'Redis and Memcached are optional memory caches; MariaDB does not require them. Enable or disable them in Services or Settings. When enabled in the PHP runtime, local apps can connect through localhost or 127.0.0.1 using the configured ports (normally 6379 for Redis and 11211 for Memcached). cwebp is a separate WebP image tool in Settings, not a PHP extension.'
  ] },
  { title: 'Hosts', intro: [
    'A Hosts entry can point example.test to 127.0.0.1, your own computer, so a browser opens the local Site. Vhostra can add or repair its own managed mappings when Sites are saved. It reports conflicts and may request administrator approval.',
    'The manual Hosts editor in Settings is a separate tool for reviewing and changing the Hosts file directly. Manual changes can affect local networking, so check names and addresses before saving.'
  ] },
  { title: 'Logs', intro: [
    'Open Logs and choose a source to view recent local output. Refresh when you need a newer tail. Copy useful lines or use the displayed path to locate a log file. The viewer reads a bounded amount on demand and does not follow files continuously.',
    'Errors may show a short message first and expandable technical details when available. Logs can contain sensitive paths or application data; review them before sharing.'
  ] },
  { title: 'Settings, backup and reset', intro: [
    'Settings changes the selected web server, PHP, optional caches, ports, startup behavior and Local Configuration Path. Startup has one service-start choice: When Vhostra opens, After login, or Manually. After login also enables Launch Vhostra on Login. Vhostra remembers the last useful Open or Save directory locally. Resources shows current app and managed-runtime usage only while that page is visible.',
    'Export Configuration saves a local bundle of settings and Site definitions without database data or secrets. Export Full Backup also includes database data, users, roles, grants and private authentication metadata in a private sibling folder. Keep both parts together in a trusted location. Restore previews conflicts and asks what to keep or replace.',
    'Reset Keep resets settings and runtime while preserving Site definitions and MariaDB data and accounts. Reset Remove also removes Vhostra definitions and database state after final confirmation. External website files stay untouched. Back up important data first.'
  ] },
  { title: 'CLI', intro: [
    'The desktop package includes a Vhostra CLI launcher. Put it on your PATH, then run vhostra followed by a command. On macOS the launcher is inside the app at Contents/Resources/bin/vhostra; on Linux it is beside VhostraDesktop, and on Windows use vhostra.cmd beside Vhostra.exe. Run help, --help or -h for the full syntax.',
    'Commands show short, readable results. Success exits with code 0; invalid syntax uses 64, errors use 1, and unhealthy or conflicted status uses 2. Status words come from the managed service state.',
    'Replace <...> placeholders with your own local values. Commands that change services, files or databases act on the current Vhostra data directory. Use VHOSTRA_USER_DATA only for a deliberately separate data directory.'
  ], entries: [
    { title: 'Help and status', text: 'Show syntax, all service states, or one service. Status targets are apache, nginx, openlitespeed, web, php, mariadb, phpmyadmin, redis and memcached. An inactive web server can be reported as inactive because only the selected server runs.', command: 'vhostra help\nvhostra status\nvhostra status mariadb', output: 'Vhostra CLI (local-only)\n\nUsage:' },
    { title: 'Runtime and services', text: 'Start, stop or restart the full environment. Target one service with start/stop/restart and a target, or use the service and runtime forms. PHP and phpMyAdmin share the selected web service lifecycle.', command: 'vhostra start\nvhostra restart web\nvhostra runtime status\nvhostra service list\nvhostra service mariadb status\nvhostra web status\nvhostra mariadb status' },
    { title: 'Sites and virtual hosts', text: 'List Sites; add or edit using a small JSON file with name, url and an existing documentRoot; remove a Site configuration after typing remove; or repair managed Site mappings. vhost list shows the underlying Site host definitions.', command: 'vhostra sites list\nvhostra sites add site.json\nvhostra sites edit <site-id> site.json\nvhostra sites remove <site-id>\nvhostra sites repair <site-id>\nvhostra vhost list' },
    { title: 'Hosts mappings', text: 'Check or repair Vhostra-owned Hosts names. Repair may request administrator approval and reports conflicts.', command: 'vhostra hosts status\nvhostra hosts repair example.test' },
    { title: 'Configuration bundles and vhost import', text: 'Export, preview or import a local Vhostra configuration bundle. For Apache, Nginx, OpenLiteSpeed or supported Enterprise text, preview first; apply converts supported settings. If the preview requires review, --accept-warnings explicitly accepts preserved inactive directives.', command: 'vhostra config export backup.json\nvhostra config preview backup.json\nvhostra config import backup.json\nvhostra import preview site.conf apache\nvhostra import apply site.conf apache --accept-warnings' },
    { title: 'Databases', text: 'List or create a database. Create asks for a hidden password in an interactive terminal; its optional character set is utf8mb4, utf8 or latin1. Import and export use local SQL files. Repair checks a database. Delete removes that database and its data after you type delete.', command: 'vhostra database list\nvhostra database create projectdb projectuser utf8mb4\nvhostra database import projectdb dump.sql\nvhostra database export projectdb dump.sql\nvhostra database repair projectdb\nvhostra database delete projectdb\nvhostra database users\nvhostra database access grant projectdb projectuser localhost' },
    { title: 'PHP, extensions and OPcache', text: 'Inspect or select a supported PHP version; list or manage optional extension packages; inspect or switch OPcache. The CLI rejects unsupported PHP versions or protected extension changes.', command: 'vhostra php versions\nvhostra php status\nvhostra php select 8.4\nvhostra php extensions list\nvhostra php extension enable <package>\nvhostra opcache status\nvhostra opcache enable' },
    { title: 'Optional caches and cwebp', text: 'Inspect, enable, disable, start, stop or restart Redis and Memcached. The service form also supports cache enable/disable. cwebp supports status, enable and disable.', command: 'vhostra redis status\nvhostra redis enable\nvhostra memcached restart\nvhostra service redis disable\nvhostra cwebp status' },
    { title: 'Interactive reset', text: 'Reset explains Keep, Remove and Cancel, then requires the exact final confirmation phrase. It cannot be run non-interactively. Back up in the graphical app first; Remove deletes Vhostra database state, while external Site files remain untouched.', command: 'vhostra reset' }
  ] },
  { title: 'Troubleshooting', intro: [
    'If Docker is missing, use Install Docker to open its official setup guide, then Check Again. If Docker is installed but stopped, use Start Docker or open Docker yourself. Choose Docker lets you select an installed command when automatic discovery fails. Vhostra never installs Docker without your action. If a required port is busy, use Settings to choose an available port or resolve the other local process yourself.',
    'If a Site does not open, confirm services are Running, the Site Root Directory exists, and its Server Name has a local Hosts mapping. Use Sites repair or Hosts status to inspect a missing mapping. A stale preview can be refreshed after the Site becomes ready.',
    'If a database connection fails, confirm MariaDB is Running and check the application’s database name, account, password and host. For an import failure, check the SQL file and error details. If phpMyAdmin is unavailable, check the web service and MariaDB. Use Logs for recent output; avoid sharing secrets from logs.'
  ] },
  { title: 'Privacy', intro: [
    'Vhostra stores the settings and local data needed for its features on this computer, including Site definitions, database data and credentials, generated configuration, logs, previews and backups. Help search runs only in this page’s memory; queries are not saved, sent or tracked.',
    'Vhostra includes no analytics, telemetry, behavioral tracking, advertising identifiers, fingerprinting, remote crash or log upload, screenshot or database-content upload, or remote collection of hostnames and paths. A user-initiated update check may request configured public HTTPS release metadata without a user or device identifier.',
    'A local website you open can make its own requests to third-party analytics, chat widgets, fonts, videos or APIs. Those requests come from that website, not Vhostra Help search or Vhostra telemetry.'
  ] }
]

function CommandBlock({ value, kind = 'command' }: { value: string; kind?: 'command' | 'output' }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1800) } catch { setCopied(false) }
  }
  return <div className="help-code mt-3 rounded-lg border border-[#E5E5E5] bg-[#F2F2F2] p-3"><div className="flex items-start gap-3"><pre className="help-copyable min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-sm leading-5"><code className="help-copyable">{value}</code></pre><button type="button" aria-label={copied ? `Copied ${kind}` : `Copy ${kind}`} onClick={() => void copy()} className="shrink-0 rounded-full border border-[#E5E5E5] bg-white px-3 py-1 text-xs font-medium hover:bg-[#F2F2F2]">{copied ? 'Copied' : 'Copy'}</button></div></div>
}

export function HelpWorkspace() {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const tabs = useRef<Array<HTMLButtonElement | null>>([])
  const normalized = query.trim().toLocaleLowerCase()
  const terms = normalized.split(/\s+/).filter(Boolean).slice(0, 8)
  const results = normalized ? topics.flatMap((topic, index) => [
    ...topic.intro.map((content, position) => ({ topic, title: topic.title, text: content, command: undefined as string | undefined, output: undefined as string | undefined, key: `intro-${index}-${position}` })),
    ...(topic.entries ?? []).map((entry, position) => ({ topic, title: entry.title, text: entry.text, command: entry.command, output: entry.output, key: `entry-${index}-${position}` })),
    ...(topic.note ? [{ topic, title: topic.title, text: topic.note, command: undefined as string | undefined, output: undefined as string | undefined, key: `note-${index}` }] : [])
  ].filter(result => terms.every(term => `${result.title} ${result.text} ${result.command ?? ''} ${result.output ?? ''}`.toLocaleLowerCase().includes(term)))) : []
  const topic = topics[active]
  const choose = (index: number) => { setActive(index); setQuery(''); tabs.current[index]?.focus({ preventScroll: true }) }
  const search = (value: string) => { setQuery(value) }
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = event.key === 'ArrowRight' ? (index + 1) % topics.length : event.key === 'ArrowLeft' ? (index - 1 + topics.length) % topics.length : event.key === 'Home' ? 0 : event.key === 'End' ? topics.length - 1 : -1
    if (next >= 0) { event.preventDefault(); choose(next); tabs.current[next]?.focus() }
  }
  return <div className="mx-auto max-w-[1000px] px-6 py-6 lg:px-8">
    <p className="text-xs font-medium uppercase tracking-[.12em] text-[#606060]">Offline documentation</p>
    <h1 className="mt-1 text-2xl font-bold">Help &amp; Documentation</h1>
    <p className="mt-3 max-w-2xl text-sm leading-5 text-[#606060]">Simple guides for Vhostra’s local development tools. Search stays on this computer.</p>
    <div className="mt-6 flex max-w-md items-center gap-2"><input aria-label="Search local help" value={query} onChange={event => search(event.target.value)} placeholder="Search local help" className="input"/>{query && <button type="button" aria-label="Clear help search" onClick={() => search('')} className="h-9 rounded-full border border-[#E5E5E5] px-3 text-sm font-medium">Clear</button>}</div>
    {!normalized && <nav aria-label="Help topics" role="tablist" className="mt-6 flex max-w-full flex-wrap gap-2">{topics.map((item, index) => <button key={item.title} ref={element => { tabs.current[index] = element }} type="button" role="tab" id={`help-tab-${index}`} aria-controls="help-panel" aria-selected={active === index} tabIndex={active === index ? 0 : -1} onKeyDown={event => onTabKey(event, index)} onClick={() => choose(index)} className={`help-tab min-h-9 rounded-full px-3 py-2 text-sm font-medium ${active === index ? 'bg-[#0F0F0F] text-white' : 'bg-[#F2F2F2] text-[#0F0F0F] hover:bg-[#E5E5E5]'}`}>{item.title}</button>)}</nav>}
    {normalized && <section aria-label="Help search results" className="mt-6 space-y-4"><p className="text-xs text-[#606060]">{results.length ? `${results.length} matching ${results.length === 1 ? 'section' : 'sections'}` : 'No documentation found for this search.'}</p>{results.map(result => <article key={result.key} id={`help-result-${result.key}`} tabIndex={-1} className="rounded-lg border border-[#E5E5E5] p-4"><p className="text-xs text-[#606060]">{result.topic.title}</p><h2 className="help-heading mt-2 text-sm font-medium">{result.title}</h2><p className="help-copyable mt-2 max-w-[75ch] whitespace-pre-wrap text-sm leading-5 text-[#606060]">{result.text}</p>{result.command && <CommandBlock value={result.command}/>}{result.output && <CommandBlock value={result.output} kind="output"/>}</article>)}</section>}
    {!normalized && <section key={active} id="help-panel" role="tabpanel" aria-labelledby={`help-tab-${active}`} className="mt-6 border-b border-[#E5E5E5] pb-6"><h2 tabIndex={-1} className="help-heading text-xl font-medium leading-7">{topic.title}</h2><div className="mt-4 space-y-3">{topic.intro.map(paragraph => <p key={paragraph} className="help-copyable max-w-[75ch] text-sm leading-5 text-[#606060]">{paragraph}</p>)}</div>{topic.entries?.map(entry => <div key={entry.title} className="mt-6"><h3 tabIndex={-1} data-help-entry={entry.title} className="help-heading text-sm font-medium leading-5">{entry.title}</h3><p className="help-copyable mt-2 max-w-[75ch] text-sm leading-5 text-[#606060]">{entry.text}</p>{entry.command && <CommandBlock value={entry.command}/>}{entry.output && <><p className="mt-3 text-xs font-medium text-[#606060]">Example output</p><CommandBlock value={entry.output} kind="output"/></>}</div>)}{topic.note && <p className="help-copyable mt-4 rounded-lg bg-[#F2F2F2] p-4 text-sm leading-5">{topic.note}</p>}</section>}
  </div>
}
