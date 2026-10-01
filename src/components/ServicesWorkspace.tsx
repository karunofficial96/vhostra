import { useEffect, useRef, useState } from 'react'
import { ServiceBrand, type ServiceBrandName } from './ServiceBrand'
import type { VhostraSettings } from '../types/domain'

type Service = { id: 'web' | 'mariadb' | 'redis' | 'memcached'; label: string; enabled: boolean; state: 'running' | 'stopped' | 'starting' | 'stopping' | 'restarting' | 'failed' | 'unhealthy' | 'disabled' | 'unavailable' }
const brandFor = (service: Service): ServiceBrandName => service.id === 'web' ? (service.label === 'Apache' ? 'Apache' : service.label === 'Nginx' ? 'Nginx' : 'OpenLiteSpeed') : service.id === 'mariadb' ? 'MariaDB' : service.id === 'redis' ? 'Redis' : 'Memcached'

export function ServicesWorkspace({ settings, running, refresh, onError }: { settings: VhostraSettings; running: boolean; refresh: () => Promise<void>; onError: (reason: unknown) => void }) {
  const [services, setServices] = useState<Service[]>([]); const [busy, setBusy] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null)
  const revision = useRef(0)
  const load = async () => { const requested = revision.current; try { const rows = await window.vhostra?.listManagedServices() ?? []; if (requested === revision.current) setServices(rows) } catch (reason) { onError(reason) } }
  useEffect(() => { void load() }, [running, settings.optionalServices.redis, settings.optionalServices.memcached])
  useEffect(() => {
    let pending: ReturnType<typeof setTimeout> | null = null
    let lastSignature = ''
    const unsubscribe = window.vhostra?.onRuntimeStatus(status => {
      const signature = `${status.state}:${status.serviceRevision ?? 0}`
      if (signature === lastSignature) return
      lastSignature = signature
      revision.current++
      const transitions = status.serviceTransitions ?? {}
      if (Object.keys(transitions).length) {
        setServices(previous => previous.map(service => transitions[service.id] ? { ...service, state: transitions[service.id]! } : service))
        return
      }
      if (pending) return
      pending = setTimeout(() => { pending = null; void load() }, 100)
    })
    return () => { unsubscribe?.(); if (pending) clearTimeout(pending) }
  }, [])
  const serviceName = (id: Service['id']) => services.find(service => service.id === id)?.label ?? id
  const control = async (id: Service['id'], action: 'start' | 'stop' | 'restart') => { try { setBusy(`${id}:${action}`); setNotice(`${action === 'stop' ? 'Stopping' : action === 'start' ? 'Starting' : 'Restarting'} ${serviceName(id)}…`); await window.vhostra?.controlManagedService(id, action); await load(); setNotice(`${serviceName(id)} state verified.`) } catch (reason) { setNotice(null); await load(); onError(reason) } finally { setBusy(null) } }
  const toggleOptional = async (id: 'redis' | 'memcached', enabled: boolean) => { try { setBusy(`${id}:${enabled ? 'enable' : 'disable'}`); setNotice(`${enabled ? 'Enabling' : 'Disabling'} ${serviceName(id)}…`); await window.vhostra?.setOptionalService(id, enabled); await refresh(); await load(); setNotice(`${serviceName(id)} state verified.`) } catch (reason) { setNotice(null); onError(reason) } finally { setBusy(null) } }
  return <div className="mx-auto max-w-[1000px] px-6 py-6 lg:px-8"><p className="text-xs font-medium uppercase tracking-[.12em] text-[#606060]">Vhostra-managed runtime</p><h1 className="mt-1 text-2xl font-bold">Services</h1><p className="mt-2 text-sm text-[#606060]">MariaDB has its own persistent container. Web, PHP and optional caches run in the shared web runtime.</p>{!running && <p className="mt-4 text-sm text-[#606060]">Start the web runtime to control web and cache services. MariaDB can start independently.</p>}{notice && <p role="status" className="selectable mt-4 rounded-lg bg-[#F2F2F2] p-3 text-sm text-[#606060]">{notice}</p>}<div className="mt-6 divide-y divide-[#E5E5E5] rounded-lg border border-[#E5E5E5]">{services.map(service => { const pending = busy?.startsWith(`${service.id}:`); const optional = service.id === 'redis' || service.id === 'memcached'; return <article key={service.id} className="flex flex-wrap items-center gap-4 p-4"><ServiceBrand name={brandFor(service)}/><div className="min-w-[160px] flex-1"><p className="text-sm font-medium">{service.label}</p><p className="mt-1 text-xs text-[#606060]">Status: <span className="selectable-status">{service.state}</span></p></div><div className="flex flex-wrap gap-2">{optional && !service.enabled && !['starting', 'stopping', 'restarting'].includes(service.state) && <button disabled={Boolean(busy)} onClick={() => void toggleOptional(service.id as 'redis' | 'memcached', true)} className="h-9 rounded-full bg-[#FF0000] px-4 text-sm font-medium text-white disabled:opacity-50">{pending ? 'Enabling…' : 'Enable'}</button>}{optional && service.enabled && !['starting', 'stopping', 'restarting'].includes(service.state) && <button disabled={Boolean(busy)} onClick={() => void toggleOptional(service.id as 'redis' | 'memcached', false)} className="h-9 rounded-full border border-[#E5E5E5] px-4 text-sm font-medium disabled:opacity-50">{pending ? 'Disabling…' : 'Disable'}</button>}{service.enabled && !['running', 'starting', 'stopping', 'restarting', 'unhealthy'].includes(service.state) && <button disabled={Boolean(busy) || (!running && service.id !== 'mariadb')} onClick={() => void control(service.id, 'start')} className="h-9 rounded-full border border-[#E5E5E5] px-4 text-sm font-medium disabled:opacity-50">{pending ? 'Starting…' : 'Start'}</button>}{service.enabled && ['running', 'unhealthy'].includes(service.state) && <button disabled={Boolean(busy) || (!running && service.id !== 'mariadb')} onClick={() => void control(service.id, 'stop')} className="h-9 rounded-full border border-[#E5E5E5] px-4 text-sm font-medium disabled:opacity-50">{pending ? 'Stopping…' : 'Stop'}</button>}{service.enabled && ['running', 'unhealthy'].includes(service.state) && <button disabled={Boolean(busy) || (!running && service.id !== 'mariadb')} onClick={() => void control(service.id, 'restart')} className="h-9 rounded-full border border-[#E5E5E5] px-4 text-sm font-medium disabled:opacity-50">{pending ? 'Restarting…' : 'Restart'}</button>}</div></article> })}{services.length === 0 && <p className="p-4 text-sm text-[#606060]">Runtime status is loading. Start Vhostra services to manage installed components.</p>}</div></div>
}
