import { useEffect, useRef, useState } from 'react'
export function QuitDialog({ open, onCancel }: { open: boolean; onCancel: () => void }) {
  const dialog = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    setError(null)
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel()
      if (event.key === 'Tab') {
        const buttons = [...(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
        const first = buttons[0]; const last = buttons.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('keydown', keydown); previous?.focus() }
  }, [open, busy])
  const quit = async (mode: 'keep-services' | 'stop-services') => {
    setBusy(true); setError(null)
    try { await window.vhostra!.quitApplication(mode) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  if (!open) return null
  return <div className="fixed inset-0 z-50 grid place-items-center overflow-auto bg-black/40 p-6" role="dialog" aria-modal="true" aria-labelledby="quit-title"><div ref={dialog} className="w-full max-w-[560px] rounded-lg bg-white p-6 shadow-xl"><h2 id="quit-title" className="text-xl font-medium">Quit Vhostra?</h2><p className="mt-4 text-sm leading-5 text-[#606060]">Choose whether to leave the web/PHP runtime, MariaDB and enabled services running after Vhostra closes.</p>{error && <p role="alert" className="mt-4 text-sm text-[#FF0000]">{error}</p>}<div className="mt-6 flex flex-wrap justify-end gap-3"><button disabled={busy} onClick={onCancel} className="h-9 rounded-full border border-[#E5E5E5] px-4 text-sm">Cancel</button><button disabled={busy} onClick={() => void quit('keep-services')} className="h-9 rounded-full border border-[#E5E5E5] px-4 text-sm font-medium">Quit Vhostra and Keep Services Running</button><button disabled={busy} onClick={() => void quit('stop-services')} className="h-9 rounded-full bg-[#FF0000] px-4 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Stopping…' : 'Quit Vhostra and Stop Services'}</button></div></div></div>
}
