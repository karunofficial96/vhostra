import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, MonitorCog, Moon, Sun } from 'lucide-react'
import type { OnboardingPreferences } from '../types/desktop-api'
import type { VhostraSettings } from '../types/domain'
import { StartupOptions } from './StartupOptions'
import { ErrorNotice } from './ErrorNotice'
import logo from '../assets/vhostra-logo-light.png'
import darkLogo from '../assets/vhostra-logo-dark.png'

export function SecondaryOnboarding({ initial, theme, onTheme, onComplete }: {
  initial: OnboardingPreferences
  theme: 'light' | 'dark'
  onTheme: (value: OnboardingPreferences['theme']) => void
  onComplete: () => Promise<void>
}) {
  const [step, setStep] = useState(0)
  const [chosenTheme, setChosenTheme] = useState(initial.theme)
  const [startup, setStartup] = useState<VhostraSettings['startup'] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { void window.vhostra!.getState().then(state => setStartup(state.settings.startup)).catch(reason => setError(String(reason))) }, [])
  const chooseTheme = async (value: OnboardingPreferences['theme']) => {
    setBusy(true)
    try { await window.vhostra!.saveOnboarding({ ...initial, theme: value }); setChosenTheme(value); onTheme(value); setError(null) }
    catch (reason) { setError(String(reason)) }
    finally { setBusy(false) }
  }
  const chooseStartup = async (value: VhostraSettings['startup']) => {
    setBusy(true)
    try { const state = await window.vhostra!.getState(); await window.vhostra!.saveSettings({ ...state.settings, startup: value }); setStartup(value); setError(null) }
    catch (reason) { setError(String(reason)) }
    finally { setBusy(false) }
  }
  const finish = async () => { setBusy(true); try { await onComplete() } catch (reason) { setError(String(reason)); setBusy(false) } }
  const titles = ['Welcome to Vhostra', 'Choose your theme', 'Startup Settings', 'Thank you for using Vhostra']
  return <main className="flex h-screen flex-col overflow-auto bg-white px-6 py-8 font-roboto text-[#0F0F0F]"><div className="mx-auto w-full max-w-[640px]"><header className="flex items-center justify-between border-b border-[#E5E5E5] pb-6"><img src={theme === 'dark' ? darkLogo : logo} alt="Vhostra" className="h-10 w-auto"/><p className="text-xs text-[#606060]">Step {step + 1} of 4</p></header><section className="py-8"><h1 className="text-2xl font-bold">{titles[step]}</h1><p className="mt-3 text-sm leading-5 text-[#606060]">{step === 0 ? 'The Vhostra environment is already set up on this computer. Choose your personal preferences to get started.' : step === 1 ? 'Choose how Vhostra looks for your OS user account.' : step === 2 ? 'Choose when Vhostra opens and starts services for your OS user account.' : 'Your preferences are ready. You can now use the shared Vhostra environment.'}</p>{step === 1 && <div className="mt-6 grid gap-3">{(['system', 'light', 'dark'] as const).map(value => { const Icon = value === 'system' ? MonitorCog : value === 'light' ? Sun : Moon; return <button key={value} type="button" aria-pressed={chosenTheme === value} disabled={busy} onClick={() => void chooseTheme(value)} className="flex min-h-16 items-center gap-4 rounded-lg border border-[#E5E5E5] px-4 py-3 text-left text-sm font-medium hover:bg-[#F2F2F2]"><Icon size={24}/>{value[0].toUpperCase() + value.slice(1)}{chosenTheme === value && <span className="ml-auto text-xs">Selected</span>}</button> })}</div>}{step === 2 && startup && <div className="mt-6 rounded-lg border border-[#E5E5E5] p-4"><StartupOptions startup={startup} disabled={busy} onChange={value => void chooseStartup(value)}/></div>}{error && <ErrorNotice error={error}/>}</section><footer className="flex justify-between border-t border-[#E5E5E5] pt-6">{step > 0 && step < 3 ? <button disabled={busy} onClick={() => setStep(step - 1)} className="flex h-9 items-center gap-2 rounded-full border border-[#E5E5E5] px-4 text-sm"><ArrowLeft size={16}/>Back</button> : <span/>}<button disabled={busy || step === 2 && !startup} onClick={() => step === 3 ? void finish() : setStep(step + 1)} className="flex h-9 items-center gap-2 rounded-full bg-[#FF0000] px-4 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Working…' : step === 3 ? 'Start using Vhostra' : 'Next'}<ArrowRight size={16}/></button></footer></div></main>
}
