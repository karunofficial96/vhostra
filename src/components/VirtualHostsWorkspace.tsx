import { useEffect, useState } from 'react'
import type { VhostraState } from '../types/domain'

type Mapping = { hostname: string; state: 'mapped' | 'required' | 'conflict'; address?: string }

export function VirtualHostsWorkspace({ state, running, refresh, onError }: { state: VhostraState; running: boolean; refresh: () => Promise<void>; onError: (reason: unknown) => void }) {
  const [notice, setNotice] = useState<string | null>(null)
  const [mappings, setMappings] = useState<Record<string, Mapping[]>>({})
  const [syncingId, setSyncingId] = useState<string | null>(null)
  const loadMappings = async () => {
    const rows = await Promise.all(state.virtualHosts.filter(host => host.hostname !== 'localhost').map(async host => [host.id, await window.vhostra?.hostsStatus(host.id) ?? []] as const))
    setMappings(Object.fromEntries(rows))
  }
  useEffect(() => { void loadMappings().catch(reason => onError(reason)) }, [state.virtualHosts])
  const sync = async (id: string) => {
    try {
      setSyncingId(id)
      setNotice('Adding missing local mappings. Vhostra will request administrator permission only for the protected hosts-file update…')
      const result = await window.vhostra?.syncHosts(id)
      setNotice(result?.message ?? 'No hosts-file update was performed.')
      await loadMappings()
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : 'The local hosts-file update failed or administrator permission was cancelled.')
      onError(reason)
    } finally { setSyncingId(null) }
  }
  const importConfiguration = async () => {
    try {
      setNotice('Importing portable virtual-host definitions and checking local hostname mappings…')
      const result = await window.vhostra?.importConfiguration()
      if (!result) return
      setNotice(`${result.message} ${result.mapping.message}`)
      await refresh()
      await loadMappings()
    } catch (reason) { onError(reason) }
  }
  return <div className="mx-auto max-w-[1200px] px-6 py-7 lg:px-8"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-medium uppercase tracking-[.12em] text-[#606060]">Server-neutral definitions</p><h1 className="mt-1 text-2xl font-bold">Virtual Hosts</h1></div><button onClick={() => void importConfiguration()} className="h-9 rounded-full border border-[#E5E5E5] px-4 text-sm font-medium hover:bg-[#F2F2F2]">Import Configuration</button></div>{notice && <p role="status" className="mt-4 rounded-lg bg-[#F2F2F2] p-3 text-sm text-[#606060]">{notice}</p>}<div className="mt-7 divide-y divide-[#E5E5E5] border-y border-[#E5E5E5]">{state.virtualHosts.map(host => { const enabled = host.rewriteEnabled !== false; const names = [host.hostname, ...host.aliases].join(', '); const mapping = mappings[host.id] ?? []; const hasRequired = mapping.some(item => item.state === 'required'); const hasConflict = mapping.some(item => item.state === 'conflict'); const mappingSummary = mapping.map(item => `${item.hostname} — ${item.state === 'mapped' ? 'Mapped' : item.state === 'conflict' ? `Conflict (${item.address})` : 'Mapping required'}`).join('; '); const actionLabel = syncingId === host.id ? 'Adding local mapping…' : hasConflict ? 'Review hosts-file conflict' : hasRequired ? 'Add local hosts mapping' : 'Repair local hosts mapping'; return <article key={host.id} className="py-4"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="font-medium">{host.hostname}</p><p className="mt-1 font-mono text-xs text-[#606060]">{host.documentRoot}</p><p className="mt-2 text-xs text-[#606060]">Local names: {names}. Vhostra adds only missing 127.0.0.1 mappings with administrator approval.</p>{mapping.length > 0 && <p className="mt-2 text-xs text-[#606060]">Hosts file: {mappingSummary}</p>}</div><Toggle label={`Rewrite / Permalinks: ${enabled ? 'Enabled' : 'Disabled'}`} checked={enabled} onChange={value => void window.vhostra?.setVirtualHostRewrite(host.id, value).then(refresh).catch(onError)}/></div><div className="mt-3 flex flex-wrap items-center gap-3"><p className="text-xs text-[#606060]">{host.rewrites.length ? `${host.rewrites.length} managed rewrite rule${host.rewrites.length === 1 ? '' : 's'}` : 'OpenLiteSpeed and Apache use .htaccess; Nginx uses Vhostra-managed compatible rules.'}</p>{host.hostname !== 'localhost' && <button disabled={syncingId !== null} onClick={() => void sync(host.id)} className="h-8 rounded-full border border-[#E5E5E5] px-3 text-xs font-medium hover:bg-[#F2F2F2] disabled:opacity-50">{actionLabel}</button>}</div></article> })}{state.virtualHosts.length === 0 && <p className="py-8 text-center text-sm text-[#606060]">No virtual hosts yet. Create a site to add a portable virtual-host definition.</p>}</div>{state.settings.selectedWebServer === 'openlitespeed' && <button disabled={!running} onClick={() => void window.vhostra?.reloadWebServer().catch(onError)} className="mt-5 h-9 rounded-full border border-[#E5E5E5] px-4 text-sm font-medium disabled:opacity-50">Gracefully reload OpenLiteSpeed</button>}</div>
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) { return <label className="flex cursor-pointer items-center justify-between gap-4 text-sm"><span>{label}</span><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} className="h-4 w-4 accent-[#FF0000]"/></label> }
