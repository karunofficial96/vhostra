import { useEffect, useRef, useState } from 'react'
import { ServiceBrand, type ServiceBrandName } from './ServiceBrand'
import type { RuntimeSnapshot, VhostraSettings } from '../types/domain'
import { RuntimeProgress } from './RuntimeProgress'
import { configurationOperationMessage, displayedConfiguration, runtimeSecondaryStatus, type ActiveConfigurationOperation } from '../configurationPresentation'
import { serviceOperationLabel, type ServiceOperation, type ServiceAction } from '../serviceOperation'

type Service = { id: 'web' | 'mariadb' | 'redis' | 'memcached'; label: string; enabled: boolean; state: 'running' | 'stopped' | 'starting' | 'stopping' | 'restarting' | 'failed' | 'unhealthy' | 'disabled' | 'unavailable' }
const brandFor = (service: Service): ServiceBrandName => service.id === 'web' ? (service.label === 'Apache' ? 'Apache' : service.label === 'Nginx' ? 'Nginx' : 'OpenLiteSpeed') : service.id === 'mariadb' ? 'MariaDB' : service.id === 'redis' ? 'Redis' : 'Memcached'

export function ServicesWorkspace({ settings, pendingSettings, activeOperation, runConfiguration, runtime, running, onError }: { settings: VhostraSettings; pendingSettings: VhostraSettings | null; activeOperation: ActiveConfigurationOperation | null; runConfiguration: (requested: VhostraSettings, apply: () => Promise<unknown>) => Promise<void>; runtime: RuntimeSnapshot | null; running: boolean; refresh: () => Promise<void>; onError: (reason: unknown) => void }) {
  const [services, setServices] = useState<Service[]>([]); const [operation, setOperation] = useState<ServiceOperation | null>(null); const [notice, setNotice] = useState<string | null>(null)
  const operationRef = useRef<ServiceOperation | null>(null)
  const operationSequence = useRef(0)
  const beginOperation = (subject: Service['id'], action: ServiceAction) => {
    if (operationRef.current || pendingSettings) return null
    const next = { id: ++operationSequence.current, subject, action }
    operationRef.current = next; setOperation(next); setNotice(`${serviceOperationLabel(action)} ${serviceName(subject)}…`)
    return next
  }
  const endOperation = (id: number) => { if (operationRef.current?.id === id) { operationRef.current = null; setOperation(null) } }
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
  const shown = displayedConfiguration(settings, pendingSettings)
  const operationMessage = configurationOperationMessage(activeOperation?.intent ?? [])
  const displayServices = services.map(service => service.id === 'web' ? { ...service, label: shown.selectedWebServer === 'nginx' ? 'Nginx' : shown.selectedWebServer === 'apache' ? 'Apache' : 'OpenLiteSpeed' } : service.id === 'redis' || service.id === 'memcached' ? { ...service, enabled: shown.optionalServices[service.id] } : service)
  const serviceName = (id: Service['id']) => services.find(service => service.id === id)?.label ?? id
  const control = async (id: Service['id'], action: 'start' | 'stop' | 'restart') => { const current = beginOperation(id, action); if (!current) return; try { await window.vhostra!.controlManagedService(id, action); revision.current++; await load(); setNotice(`${serviceName(id)} state verified.`) } catch (reason) { revision.current++; await load(); setNotice(`Could not ${action} ${serviceName(id)}. Check the error above.`); onError(reason) } finally { endOperation(current.id) } }
  const toggleOptional = async (id: 'redis' | 'memcached', enabled: boolean) => { const action = enabled ? 'enable' : 'disable'; const current = beginOperation(id, action); if (!current) return; try { await runConfiguration({ ...settings, optionalServices: { ...settings.optionalServices, [id]: enabled } }, () => window.vhostra!.setOptionalService(id, enabled)); revision.current++; await load(); setNotice(`${serviceName(id)} state verified.`) } catch (reason) { revision.current++; await load(); setNotice(`Could not ${action} ${serviceName(id)}. Check the error above.`); onError(reason) } finally { endOperation(current.id) } }
  return <div className="mx-auto max-w-[1000px] px-6 py-6 lg:px-8"><p className="text-xs font-medium uppercase tracking-[.12em] text-[#606060]">Vhostra-managed runtime</p><h1 className="mt-1 text-2xl font-bold">Services</h1><p className="mt-2 text-sm text-[#606060]">MariaDB has its own persistent container. Web, PHP and optional caches run in the shared web runtime.</p>{!running && <p className="mt-4 text-sm text-[#606060]">Start the web runtime to control web and cache services. MariaDB can start independently.</p>}{notice && <p role="status" className="selectable mt-4 rounded-lg bg-[#F2F2F2] p-3 text-sm text-[#606060]">{notice}</p>}<section id="services-runtime-status" className="mt-6 rounded-lg border border-[#E5E5E5] p-4"><h2 className="text-xl font-medium">Runtime Status</h2><p className="mt-2 text-sm text-[#606060]">{operationMessage ?? (operation ? `${serviceOperationLabel(operation.action)} ${serviceName(operation.subject)}…` : notice) ?? (running ? 'Web runtime running' : 'Web runtime stopped')}</p><p className="mt-2 text-xs text-[#606060]">{activeOperation ? runtimeSecondaryStatus(runtime, activeOperation, shown) : `Requested configuration · ${shown.selectedWebServer === 'nginx' ? 'Nginx' : shown.selectedWebServer === 'apache' ? 'Apache' : 'OpenLiteSpeed'} · PHP ${shown.selectedPhpVersion}`}</p>{displayServices.map(service => <p key={service.id} className="mt-2 text-xs text-[#606060]">{service.label}: {service.enabled ? 'Configured' : 'Disabled'} · {service.state}</p>)}<RuntimeProgress runtime={runtime}/></section><div className="mt-6 divide-y divide-[#E5E5E5] rounded-lg border border-[#E5E5E5]">{displayServices.map(service => { const pending = operation?.subject === service.id ? operation : null; const requestedEnabled = pending?.action === 'enable' ? true : pending?.action === 'disable' ? false : service.enabled; const optional = service.id === 'redis' || service.id === 'memcached'; return <article key={service.id} className="flex flex-wrap items-center gap-4 p-4"><ServiceBrand name={brandFor(service)}/><div className="min-w-[160px] flex-1"><p className="text-sm font-medium">{service.label}</p><p className="mt-1 text-xs text-[#606060]">Configured: {requestedEnabled ? 'Enabled' : 'Disabled'} · Status: <span className="selectable-status">{pending ? serviceOperationLabel(pending.action) : service.state}</span></p></div><div className="flex flex-wrap gap-2">{pending ? <button disabled className="h-9 rounded-full border border-[#E5E5E5] px-4 text-sm font-medium disabled:opacity-50">{serviceOperationLabel(pending.action)}…</button> : <>{optional && !requestedEnabled && !['starting', 'stopping', 'restarting'].includes(service.state) && <button disabled={Boolean(operation || pendingSettings)} onClick={() => void toggleOptional(service.id as 'redis' | 'memcached', true)} className="h-9 rounded-full bg-[#FF0000] px-4 text-sm font-medium text-white disabled:opacity-50">Enable</button>}{optional && requestedEnabled && !['starting', 'stopping', 'restarting'].includes(service.state) && <button disabled={Boolean(operation || pendingSettings)} onClick={() => void toggleOptional(service.id as 'redis' | 'memcached', false)} className="h-9 rounded-full border border-[#E5E5E5] px-4 text-sm font-medium disabled:opacity-50">Disable</button>}{service.enabled && !['running', 'starting', 'stopping', 'restarting', 'unhealthy'].includes(service.state) && <button disabled={Boolean(operation || pendingSettings) || (!running && service.id !== 'mariadb')} onClick={() => void control(service.id, 'start')} className="h-9 rounded-full border border-[#E5E5E5] px-4 text-sm font-medium disabled:opacity-50">Start</button>}{service.enabled && ['running', 'unhealthy'].includes(service.state) && <button disabled={Boolean(operation || pendingSettings) || (!running && service.id !== 'mariadb')} onClick={() => void control(service.id, 'stop')} className="h-9 rounded-full border border-[#E5E5E5] px-4 text-sm font-medium disabled:opacity-50">Stop</button>}{service.enabled && ['running', 'unhealthy'].includes(service.state) && <button disabled={Boolean(operation || pendingSettings) || (!running && service.id !== 'mariadb')} onClick={() => void control(service.id, 'restart')} className="h-9 rounded-full border border-[#E5E5E5] px-4 text-sm font-medium disabled:opacity-50">Restart</button>}</>}</div></article> })}{services.length === 0 && <p className="p-4 text-sm text-[#606060]">Runtime status is loading. Start Vhostra services to manage installed components.</p>}</div></div>
}
