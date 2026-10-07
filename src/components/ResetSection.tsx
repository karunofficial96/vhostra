import { ErrorNotice } from './ErrorNotice'
import { useEffect, useRef, useState } from 'react'
export function ResetSection({ onReset, onUserReset }: { onReset: () => Promise<void>; onUserReset: () => Promise<void> }) {
  const dialog = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState<'idle' | 'confirm'>('idle')
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [userMessage, setUserMessage] = useState<string | null>(null)
  useEffect(() => {
    if (stage === 'idle') return
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) { event.preventDefault(); setStage('idle'); setError(null) }
      if (event.key === 'Tab') {
        const buttons = [...(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
        if (!buttons.length) { event.preventDefault(); return }
        const first = buttons[0]; const last = buttons[buttons.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('keydown', keydown); previous?.focus() }
  }, [stage, busy])
  const reset = async () => { setBusy(true); setError(null); try { await window.vhostra!.resetApp(true, 'Yes, Reset Vhostra'); await onReset() } catch (reason) { setError(String(reason)) } finally { setBusy(false) } }
  const resetUser = async () => { setBusy(true); setError(null); try { const result = await window.vhostra!.resetUserPreferences(); await onUserReset(); setUserMessage(result.message) } catch (reason) { setError(String(reason)) } finally { setBusy(false) } }
  return <section className="mx-auto mb-8 max-w-[1200px] px-6 lg:px-8"><div className="mb-6 rounded-lg border border-[#E5E5E5] p-4"><h2 className="text-xl font-medium">Reset this user’s preferences</h2><p className="mt-2 text-sm leading-5 text-[#606060]">Reset only your theme, startup mode and close-button behavior. Services, Sites, certificates and databases in this profile stay as they are.</p><button disabled={busy} onClick={() => void resetUser()} className="mt-4 h-9 rounded-full border border-[#E5E5E5] px-4 text-sm font-medium disabled:opacity-50">Reset my preferences</button>{userMessage && <p role="status" className="selectable mt-3 text-sm">{userMessage}</p>}{error && stage === 'idle' && <ErrorNotice error={error}/>}</div><div className="rounded-lg border border-[#E5E5E5] p-4"><h2 className="text-xl font-medium">Reset Vhostra</h2><p className="mt-2 text-sm leading-5 text-[#606060]">Restore application settings and generated runtime configuration. MariaDB databases, credentials, certificates, Site definitions and external website files are preserved.</p><button onClick={() => setStage('confirm')} className="mt-4 h-9 rounded-full border border-[#E5E5E5] px-4 text-sm font-medium text-[#FF0000]">Reset Vhostra…</button></div>{stage !== 'idle' && <div className="fixed inset-0 z-50 grid place-items-center overflow-auto bg-black/40 p-6" role="dialog" aria-modal="true" aria-labelledby="reset-title"><div ref={dialog} className="w-full max-w-[560px] rounded-lg bg-white p-6 shadow-xl"><h2 id="reset-title" className="text-xl font-medium">Are you sure you want to reset?</h2><p className="mt-4 text-sm leading-5 text-[#606060]">Settings and generated runtime configuration will reset. MariaDB data, credentials, certificates, Site definitions and external website files will be preserved. Vhostra will return to onboarding.</p>{error && <ErrorNotice error={error}/>} <div className="mt-6 flex flex-wrap justify-end gap-3"><button disabled={busy} onClick={() => { setStage('idle'); setError(null) }} className="h-9 rounded-full border border-[#E5E5E5] px-4 text-sm">No</button><button disabled={busy} onClick={() => void reset()} className="h-9 rounded-full bg-[#FF0000] px-4 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Resetting…' : 'Yes, Reset Vhostra'}</button></div></div></div>}</section>
}
