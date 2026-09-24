import { useState, type ElementType } from 'react'
import { Activity, Archive, Box, Braces, ChevronRight, CircleHelp, Database, Download, FileText, Folder, Globe2, HardDrive, LayoutDashboard, Lock, Menu, Moon, Network, Plus, Server, Settings, Sun, TerminalSquare, Upload, Zap } from 'lucide-react'
import logo from './assets/vhostra-logo-light.png'
import { mockBundleManifest, mockServices, mockSites, mockStorageLayout, mockVirtualHosts } from './data/mock-data'

type NavItem = { label: string; icon: ElementType }
const navItems: NavItem[] = [
  { label: 'Dashboard', icon: LayoutDashboard }, { label: 'Sites', icon: Globe2 }, { label: 'Virtual Hosts', icon: Network },
  { label: 'Database', icon: Database }, { label: 'phpMyAdmin', icon: Braces }, { label: 'Server', icon: Server },
  { label: 'PHP', icon: TerminalSquare }, { label: 'Services', icon: Box }, { label: 'Logs', icon: FileText }, { label: 'Settings', icon: Settings },
]

const ToolTip = ({ label, children }: { label: string; children: React.ReactNode }) => <div className="group relative">{children}<span role="tooltip" className="pointer-events-none absolute left-[calc(100%+10px)] top-1/2 z-30 hidden -translate-y-1/2 whitespace-nowrap rounded bg-[#606060] px-2 py-1 text-xs text-white shadow-sm group-hover:block group-focus-within:block">{label}</span></div>

const StatusDot = ({ status = 'running' }: { status?: string }) => <span className={`inline-block h-2 w-2 rounded-full ${status === 'running' ? 'bg-[#2BA640]' : 'bg-[#606060]'}`} />

export function App() {
  const [collapsed, setCollapsed] = useState(false)
  const [active, setActive] = useState('Dashboard')
  const [appearance, setAppearance] = useState<'light' | 'system' | 'dark'>('light')
  const compact = collapsed ? 'w-[72px]' : 'w-[240px]'
  const cycleAppearance = () => setAppearance(value => value === 'light' ? 'system' : value === 'system' ? 'dark' : 'light')
  const appearanceIcon = appearance === 'light' ? Sun : appearance === 'dark' ? Moon : CircleHelp
  const AppearanceIcon = appearanceIcon

  return <main className="flex h-screen min-w-[720px] overflow-hidden bg-white font-roboto text-[#0F0F0F]">
    <aside className={`${compact} flex shrink-0 flex-col border-r border-[#E5E5E5] bg-white transition-[width] duration-200`}>
      <div className="flex h-14 items-center gap-2 px-3">
        <ToolTip label={collapsed ? 'Expand navigation' : 'Collapse navigation'}><button aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setCollapsed(!collapsed)} className="grid h-10 w-10 place-items-center rounded-full text-[#606060] hover:bg-[#F2F2F2]"><Menu size={20} /></button></ToolTip>
        {!collapsed && <img src={logo} alt="Vhostra" className="h-8 w-[120px] object-cover object-left" />}
      </div>
      <nav aria-label="Primary navigation" className="flex-1 space-y-1 px-2 py-3">
        {navItems.map(({ label, icon: Icon }) => <ToolTip label={label} key={label}><button onClick={() => setActive(label)} aria-current={active === label ? 'page' : undefined} className={`flex h-11 w-full items-center gap-4 rounded-lg px-3 text-sm ${active === label ? 'bg-[#F2F2F2] font-bold text-[#0F0F0F]' : 'font-medium text-[#606060] hover:bg-[#F2F2F2] hover:text-[#0F0F0F]'} ${collapsed ? 'justify-center px-0' : ''}`}><Icon size={19} strokeWidth={active === label ? 2.4 : 2} /><span className={collapsed ? 'sr-only' : ''}>{label}</span></button></ToolTip>)}
      </nav>
      <div className="border-t border-[#E5E5E5] p-2"><ToolTip label="Help & documentation"><button aria-label="Help and documentation" className={`flex h-10 w-full items-center gap-4 rounded-lg px-3 text-sm font-medium text-[#606060] hover:bg-[#F2F2F2] ${collapsed ? 'justify-center px-0' : ''}`}><CircleHelp size={19}/><span className={collapsed ? 'sr-only' : ''}>Help & documentation</span></button></ToolTip></div>
    </aside>
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[#E5E5E5] bg-white px-6">
        <div className="flex items-center gap-3"><span className="text-sm font-medium text-[#606060]">Environment</span><span className="rounded-full bg-[#0F0F0F] px-3 py-1 text-xs font-medium text-white">Local</span></div>
        <div className="flex items-center gap-2"><span className="hidden text-xs text-[#606060] sm:inline">Appearance</span><ToolTip label={`Appearance: ${appearance}. Click to switch`}><button aria-label={`Appearance: ${appearance}`} onClick={cycleAppearance} className="grid h-10 w-10 place-items-center rounded-full text-[#606060] hover:bg-[#F2F2F2]"><AppearanceIcon size={19}/></button></ToolTip><div className="ml-1 h-7 w-7 rounded-full bg-[#0F0F0F] text-center text-xs leading-7 text-white">V</div></div>
      </header>
      <div className="min-w-0 flex-1 overflow-auto">{active === 'Settings' ? <SettingsPage /> : active === 'Logs' ? <LogsPage /> : <Dashboard />}</div>
    </section>
  </main>
}

function Dashboard() {
  return <div className="mx-auto max-w-[1600px] px-6 py-7 lg:px-8">
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4"><div><p className="mb-1 text-xs font-medium uppercase tracking-[0.12em] text-[#606060]">Local PHP environment</p><h1 className="text-2xl font-bold tracking-tight">Dashboard</h1></div><button className="inline-flex h-9 items-center gap-2 rounded-full bg-[#FF0000] px-4 text-sm font-medium text-white hover:bg-[#CC0000]"><Plus size={17}/> Add site</button></div>
    <section aria-label="Environment status" className="mb-7 grid gap-4 md:grid-cols-3">
      <StatCard icon={Server} label="Web server" value="Nginx" detail="Ready on port 80" /><StatCard icon={TerminalSquare} label="PHP runtime" value="PHP 8.4" detail="FPM is responding" /><StatCard icon={Database} label="MariaDB" value="Running" detail="Port 3306 · persistent" status="running" />
    </section>
    <section className="mb-7"><div className="mb-3 flex items-center justify-between"><h2 className="text-xl font-medium">Sites</h2><button className="text-sm font-medium text-[#065FD4] hover:underline">View all sites</button></div><div className="grid gap-4 lg:grid-cols-3">
      {mockSites.map((site, index) => { const host = mockVirtualHosts[index]; return <article key={site.id} className="group border-b border-[#E5E5E5] pb-4"><div className="mb-3 flex aspect-[16/7] items-end justify-between rounded-xl bg-gradient-to-br from-[#191919] via-[#282828] to-[#4a1717] p-4"><span className="rounded bg-black/60 px-2 py-1 font-mono text-xs text-white">{site.framework}</span><span className="flex items-center gap-1.5 rounded bg-black/60 px-2 py-1 text-xs font-medium text-white"><StatusDot/> Running</span></div><div className="flex items-start justify-between gap-3"><div><h3 className="text-base font-medium">{site.name}</h3><a href={`https://${host.hostname}`} className="text-sm text-[#065FD4] hover:underline">{host.hostname}</a><p className="mt-1 truncate font-mono text-xs text-[#606060]">{site.path}</p></div><button aria-label={`Open ${site.name} actions`} className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[#606060] hover:bg-[#F2F2F2]"><ChevronRight size={18}/></button></div></article> })}
    </div></section>
    <div className="grid gap-7 xl:grid-cols-[1.6fr_1fr]"><section><div className="mb-3 flex items-center justify-between"><h2 className="text-xl font-medium">Shared services</h2><button className="text-sm font-medium text-[#065FD4] hover:underline">Manage services</button></div><div className="divide-y divide-[#E5E5E5] border-y border-[#E5E5E5]">{mockServices.map(service => <div key={service.name} className="flex items-center justify-between py-3"><div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-full bg-[#F2F2F2] text-[#606060]"><Box size={17}/></div><div><p className="text-sm font-medium capitalize">{service.name === 'phpmyadmin' ? 'phpMyAdmin' : service.name}</p><p className="text-xs text-[#606060]">{service.required ? 'Required service' : 'Optional shared service'}{service.port ? ` · ${service.port}` : ''}</p></div></div><div className="flex items-center gap-2 text-xs font-medium"><StatusDot status={service.status}/><span className={service.status === 'running' ? 'text-[#2BA640]' : 'text-[#606060]'}>{service.status === 'running' ? 'Running' : service.enabled ? 'Starting' : 'Disabled'}</span></div></div>)}</div></section>
      <section><h2 className="mb-3 text-xl font-medium">Activity</h2><div className="rounded-lg border border-[#E5E5E5] p-4"><Activity className="mb-4 text-[#FF0000]" size={20}/><ol className="space-y-4 border-l border-[#E5E5E5] pl-4 text-sm"><li><p className="font-medium">Environment is healthy</p><p className="text-xs text-[#606060]">All required services are responding</p></li><li><p className="font-medium">3 virtual hosts loaded</p><p className="text-xs text-[#606060]">Host project files remain on your computer</p></li><li><p className="font-medium">Runtime uses dedicated resources</p><p className="text-xs text-[#606060]">vhostra_default network · isolated</p></li></ol></div></section>
    </div>
    <div className="mt-7 flex items-start gap-3 rounded-lg bg-[#F2F2F2] p-4"><Zap className="mt-0.5 shrink-0 text-[#FF0000]" size={18}/><p className="text-sm leading-5 text-[#606060]"><span className="font-medium text-[#0F0F0F]">Foundation preview.</span> Runtime controls, imports, and configuration changes are intentionally inactive in this first iteration.</p></div>
  </div>
}

function SettingsPage() {
  const [notice, setNotice] = useState<string | null>(null)
  const configGroups = [
    ['Vhostra source', 'Settings, sites, and neutral virtual-host definitions', 'configuration/source'],
    ['Custom configuration', 'User-owned additions are never overwritten automatically', 'configuration/custom'],
    ['Generated runtime', 'Inspectable Apache, Nginx, OpenLiteSpeed, PHP, and service files', 'configuration/generated'],
  ]
  return <div className="mx-auto max-w-[1200px] px-6 py-7 lg:px-8">
    <div className="mb-8"><p className="mb-1 text-xs font-medium uppercase tracking-[0.12em] text-[#606060]">Local-first configuration</p><h1 className="text-2xl font-bold tracking-tight">Settings</h1><p className="mt-2 max-w-2xl text-sm leading-5 text-[#606060]">Vhostra’s portable source configuration remains separate from user-owned custom files and generated runtime files. All planned storage lives on the host computer.</p></div>
    {notice && <div role="status" className="mb-6 flex items-center justify-between gap-4 rounded-lg bg-[#F2F2F2] p-4 text-sm text-[#606060]"><span>{notice}</span><button aria-label="Dismiss notice" onClick={() => setNotice(null)} className="text-sm font-medium text-[#065FD4]">Dismiss</button></div>}
    <section className="mb-8"><div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-medium">Configuration portability</h2><p className="mt-1 text-xs text-[#606060]">Bundle format: <span className="font-mono">{mockBundleManifest.format} v{mockBundleManifest.schemaVersion}</span></p></div><div className="flex gap-2"><button onClick={() => setNotice('Configuration import is an architecture placeholder; no files have been selected or changed.')} className="inline-flex h-9 items-center gap-2 rounded-full border border-[#E5E5E5] px-4 text-sm font-medium hover:bg-[#F2F2F2]"><Upload size={16}/> Import configuration</button><button onClick={() => setNotice('Export Configuration is prepared. Bundle generation and file selection will be added with the filesystem backend.')} className="inline-flex h-9 items-center gap-2 rounded-full bg-[#FF0000] px-4 text-sm font-medium text-white hover:bg-[#CC0000]"><Download size={16}/> Export Configuration</button></div></div>
      <div className="grid gap-4 md:grid-cols-3">{configGroups.map(([title, description, path]) => <article key={title} className="border-b border-[#E5E5E5] pb-4"><div className="mb-3 grid h-10 w-10 place-items-center rounded-full bg-[#F2F2F2] text-[#606060]"><Folder size={19}/></div><h3 className="text-sm font-medium">{title}</h3><p className="mt-1 min-h-10 text-xs leading-4 text-[#606060]">{description}</p><p className="mt-3 truncate font-mono text-xs text-[#606060]">{path}</p></article>)}</div>
    </section>
    <div className="grid gap-7 lg:grid-cols-[1.3fr_1fr]"><section><div className="mb-3 flex items-center gap-2"><HardDrive size={19} className="text-[#606060]"/><h2 className="text-xl font-medium">Host storage plan</h2></div><div className="divide-y divide-[#E5E5E5] border-y border-[#E5E5E5]">{[
      ['Definitions', `${mockStorageLayout.sites} · ${mockStorageLayout.virtualHosts}`], ['Runtime configuration', `${mockStorageLayout.runtime.apache} · ${mockStorageLayout.runtime.nginx} · ${mockStorageLayout.runtime.openLiteSpeed}`], ['Services & data', `${mockStorageLayout.runtime.php} · ${mockStorageLayout.runtime.mariaDb} · ${mockStorageLayout.persistentData.mariaDb}`], ['Recovery', `${mockStorageLayout.backups} · ${mockStorageLayout.exports}`], ['Certificates & logs', `${mockStorageLayout.certificates.directory} · ${mockStorageLayout.logs}`],
    ].map(([label, path]) => <div key={label} className="py-3"><p className="text-sm font-medium">{label}</p><p className="mt-1 truncate font-mono text-xs text-[#606060]">{path}</p></div>)}</div><p className="mt-3 text-xs leading-4 text-[#606060]">The final platform adapter supplies the application-data location for macOS, Windows, or Linux. Website document roots are separate user-selected host directories.</p></section>
      <section><div className="mb-3 flex items-center gap-2"><Lock size={19} className="text-[#606060]"/><h2 className="text-xl font-medium">Bundle privacy</h2></div><div className="rounded-lg border border-[#E5E5E5] p-4"><p className="text-sm font-medium">Excluded by default</p><ul className="mt-3 space-y-2 text-sm text-[#606060]">{mockBundleManifest.excludedByDefault.map(item => <li className="flex items-center gap-2" key={item}><span className="h-1.5 w-1.5 rounded-full bg-[#FF0000]"/>{item.replaceAll('-', ' ')}</li>)}</ul><p className="mt-4 border-t border-[#E5E5E5] pt-3 text-xs leading-4 text-[#606060]">Private TLS keys, passwords, website content, and database contents require separate explicit backup/export behavior.</p></div></section></div>
    <div className="mt-7 flex items-start gap-3 rounded-lg bg-[#F2F2F2] p-4"><Archive className="mt-0.5 shrink-0 text-[#FF0000]" size={18}/><p className="text-sm leading-5 text-[#606060]"><span className="font-medium text-[#0F0F0F]">Recovery-first plan.</span> A local snapshot will be created before an import, migration, or important configuration replacement. Generated files can be replaced; user-custom files must be preserved.</p></div>
  </div>
}

function LogsPage() {
  return <div className="mx-auto max-w-[1200px] px-6 py-7 lg:px-8"><div className="mb-8"><p className="mb-1 text-xs font-medium uppercase tracking-[0.12em] text-[#606060]">Persistent host files</p><h1 className="text-2xl font-bold tracking-tight">Logs</h1><p className="mt-2 text-sm text-[#606060]">Vhostra, web-server, PHP, and database logs will remain accessible on the host and through this workspace.</p></div><section className="rounded-lg border border-[#E5E5E5] p-5"><div className="mb-5 flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-full bg-[#F2F2F2] text-[#606060]"><FileText size={19}/></div><div><h2 className="text-sm font-medium">Persistent log directory</h2><p className="font-mono text-xs text-[#606060]">{mockStorageLayout.logs}</p></div></div><div className="divide-y divide-[#E5E5E5] border-y border-[#E5E5E5]">{['vhostra/application.log', 'nginx/access.log', 'php/error.log', 'mariadb/error.log'].map((file, index) => <div key={file} className="flex items-center justify-between py-3"><div><p className="font-mono text-sm">{file}</p><p className="mt-1 text-xs text-[#606060]">Persistent host log · planned reader</p></div><span className={`rounded px-2 py-1 text-xs font-medium ${index === 0 ? 'bg-[#F2F2F2] text-[#0F0F0F]' : 'bg-[#F2F2F2] text-[#606060]'}`}>Not connected</span></div>)}</div><p className="mt-4 text-xs text-[#606060]">Log streaming and file access are placeholders; no runtime logs are read in this iteration.</p></section></div>
}

function StatCard({ icon: Icon, label, value, detail, status = 'running' }: { icon: ElementType; label: string; value: string; detail: string; status?: string }) { return <article className="border-b border-[#E5E5E5] bg-white pb-4"><div className="mb-4 flex items-center justify-between"><div className="grid h-10 w-10 place-items-center rounded-full bg-[#F2F2F2] text-[#606060]"><Icon size={20}/></div><span className="flex items-center gap-1.5 text-xs font-medium text-[#2BA640]"><StatusDot status={status}/> Healthy</span></div><p className="text-xs font-medium uppercase tracking-[0.08em] text-[#606060]">{label}</p><p className="mt-1 text-xl font-medium">{value}</p><p className="mt-1 text-xs text-[#606060]">{detail}</p></article> }
