import type { VhostraSettings } from '../types/domain'

type Startup = VhostraSettings['startup']
export function StartupOptions({ startup, disabled, onChange }: { startup: Startup; disabled: boolean; onChange: (next: Startup) => void }) {
  return <div className="space-y-4">
    <label className="flex items-center gap-3 text-sm"><input type="checkbox" disabled={disabled} checked={startup.launchAtLogin} onChange={event => onChange({ ...startup, launchAtLogin: event.target.checked })} className="h-[18px] w-[18px] accent-[#065FD4]"/>Launch Vhostra on Login</label>
    <label className="flex items-center gap-3 text-sm"><input type="checkbox" disabled={disabled} checked={startup.serviceStartMode === 'after-login'} onChange={event => onChange({ ...startup, serviceStartMode: event.target.checked ? 'after-login' : 'manual' })} className="h-[18px] w-[18px] accent-[#065FD4]"/>Run Services on Login</label>
    <label className="flex items-center gap-3 text-sm"><input type="checkbox" disabled={disabled} checked={startup.serviceStartMode === 'on-open'} onChange={event => onChange({ ...startup, serviceStartMode: event.target.checked ? 'on-open' : 'manual' })} className="h-[18px] w-[18px] accent-[#065FD4]"/>Run Services when Vhostra opens</label>
    <p className="text-xs leading-5 text-[#606060]">Login service startup uses a background launch when the window option is off. It requires macOS to accept Vhostra’s login item.</p>
  </div>
}
