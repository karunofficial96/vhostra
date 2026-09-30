import { useState, type ChangeEvent } from 'react'

export function PasswordField({ label, ariaLabel = label, value, onChange, autoComplete = 'new-password', minLength, required = true, className = '' }: { label: string; ariaLabel?: string; value: string; onChange: (event: ChangeEvent<HTMLInputElement>) => void; autoComplete?: string; minLength?: number; required?: boolean; className?: string }) {
  const [visible, setVisible] = useState(false)
  return <div className={className}><label className="block text-sm font-medium">{label}<input aria-label={ariaLabel} autoComplete={autoComplete} type={visible ? 'text' : 'password'} required={required} minLength={minLength} value={value} onChange={onChange} className="input mt-2"/></label><button type="button" aria-label={`${visible ? 'Hide' : 'Show'} ${label}`} aria-pressed={visible} onClick={() => setVisible(!visible)} className="mt-2 text-sm font-medium text-[#065FD4] hover:underline">{visible ? 'Hide Password' : 'Show Password'}</button></div>
}
