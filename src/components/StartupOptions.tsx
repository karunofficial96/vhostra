import type { VhostraSettings } from '../types/domain'

type Startup = VhostraSettings['startup']
export function StartupOptions({ startup, disabled, onChange }: { startup: Startup; disabled: boolean; onChange: (next: Startup) => void }) {
  const modes: Array<[Startup['serviceStartMode'], string]> = [['on-open', 'When Vhostra opens'], ['after-login', 'After login'], ['manual', 'Manually']]
  return <div className="space-y-4">
    <label className="flex items-center gap-3 text-sm"><input type="checkbox" disabled={disabled} checked={startup.launchAtLogin} onChange={event => onChange({ ...startup, launchAtLogin: event.target.checked, serviceStartMode: !event.target.checked && startup.serviceStartMode === 'after-login' ? 'manual' : startup.serviceStartMode })} className="h-[18px] w-[18px] accent-[#065FD4]"/>Launch Vhostra on Login</label>
    <fieldset className="space-y-3"><legend className="mb-3 text-sm font-medium">Start configured services</legend>{modes.map(([mode, label]) => <label key={mode} className="flex items-center gap-3 text-sm"><input type="radio" name="service-start-mode" disabled={disabled} checked={startup.serviceStartMode === mode} onChange={() => onChange({ ...startup, serviceStartMode: mode, launchAtLogin: mode === 'after-login' ? true : startup.launchAtLogin })} className="h-[18px] w-[18px] accent-[#065FD4]"/>{label}</label>)}</fieldset>
    {startup.serviceStartMode === 'after-login' && <p className="text-xs leading-5 text-[#606060]">After login opens Vhostra and starts configured services once. Selecting it also enables Launch Vhostra on Login.</p>}
  </div>
}
