import { useEffect, useRef, useState } from 'react'
export function ResetSection({ onReset }: { onReset: () => Promise<void> }) {
  const dialog = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState<'idle' | 'choice' | 'confirm'>('idle')
  const [keep, setKeep] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null)
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
  const reset = async () => { setBusy(true); setError(null); try { await window.vhostra!.resetApp(keep, 'Yes, Reset Vhostra'); await onReset() } catch (reason) { setError(String(reason)) } finally { setBusy(false) } }
  return <section className="mx-auto mb-8 max-w-[1200px] px-6 lg:px-8"><div className="rounded-lg border border-[#E5E5E5] p-4"><h2 className="text-xl font-medium">Reset Vhostra</h2><p className="mt-2 text-sm leading-5 text-[#606060]">Restore application settings and runtime configuration to a fresh state. Back up databases, Site definitions and other important configuration first. External site root files will remain untouched.</p><p className="mt-3 text-sm font-medium">Keep configurations preserves MariaDB databases, users, roles, grants, credentials and relevant persistent Site state. Remove configurations resets Vhostra database state.</p><button onClick={() => setStage('choice')} className="mt-4 h-9 rounded-full border border-[#E5E5E5] px-4 text-sm font-medium text-[#FF0000]">Reset Vhostra…</button></div>{stage !== 'idle' && <div className="fixed inset-0 z-50 grid place-items-center overflow-auto bg-black/40 p-6" role="dialog" aria-modal="true" aria-labelledby="reset-title"><div ref={dialog} className="w-full max-w-[560px] rounded-lg bg-white p-6 shadow-xl"><h2 id="reset-title" className="text-xl font-medium">{stage === 'choice' ? 'Keep existing Site/vhost configurations?' : 'Are you sure you want to reset?'}</h2><p className="mt-4 text-sm leading-5 text-[#606060]">{stage === 'choice' ? 'Keep preserves Site/vhost definitions and MariaDB data/configuration. Remove deletes Vhostra definitions and database state. External Site files remain untouched in both modes.' : `Settings and runtime will reset. MariaDB databases/users/roles/grants and credentials will be ${keep ? 'preserved' : 'removed/reset; export a logical database backup first'}. Site configurations will be ${keep ? 'kept' : 'removed'}. External Site root files remain untouched. Vhostra will return to onboarding.`}</p>{error && <p role="alert" className="mt-4 text-sm text-[#B00020]">{error}</p>}<div className="mt-6 flex flex-wrap justify-end gap-3"><button disabled={busy} onClick={() => { setStage('idle'); setError(null) }} className="h-9 rounded-full border border-[#E5E5E5] px-4 text-sm">{stage === 'choice' ? 'Cancel' : 'No'}</button>{stage === 'choice' ? <><button onClick={() => { setKeep(true); setStage('confirm') }} className="h-9 rounded-full border border-[#E5E5E5] px-4 text-sm font-medium">Keep configurations</button><button onClick={() => { setKeep(false); setStage('confirm') }} className="h-9 rounded-full border border-[#E5E5E5] px-4 text-sm font-medium">Remove configurations</button></> : <button disabled={busy} onClick={() => void reset()} className="h-9 rounded-full bg-[#FF0000] px-4 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Resetting…' : 'Yes, Reset Vhostra'}</button>}</div></div></div>}</section>
}
