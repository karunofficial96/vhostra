import type { VhostraSettings } from '../types/domain'

type Startup = VhostraSettings['startup']
export function StartupOptions({ startup, disabled, onChange }: { startup: Startup; disabled: boolean; onChange: (next: Startup) => void }) {
  const modes: Array<[Startup['serviceStartMode'], string]> = [['manual', 'Manual'], ['on-open', 'Run Services When Vhostra Opens'], ['after-login', 'Run Services on Login']]
  return <div className="space-y-4">
    <fieldset className="space-y-3"><legend className="mb-3 text-sm font-medium">Start configured services</legend>{modes.map(([mode, label]) => <label key={mode} className="flex items-center gap-3 text-sm"><input type="radio" name="service-start-mode" disabled={disabled} checked={startup.serviceStartMode === mode} onChange={() => onChange({ ...startup, serviceStartMode: mode, launchAtLogin: mode === 'after-login' ? false : startup.launchAtLogin })} className="h-[18px] w-[18px] accent-[#065FD4]"/>{label}</label>)}</fieldset>
    <label className="flex items-center gap-3 text-sm"><input type="checkbox" disabled={disabled || startup.serviceStartMode === 'after-login'} checked={startup.serviceStartMode !== 'after-login' && startup.launchAtLogin} onChange={event => onChange({ ...startup, launchAtLogin: event.target.checked })} className="h-[18px] w-[18px] accent-[#065FD4]"/>Launch Vhostra on Login</label>
    {startup.serviceStartMode === 'after-login' && <p className="text-xs leading-5 text-[#606060]">Services start in the background at login without opening the Vhostra window.</p>}
  </div>
}
