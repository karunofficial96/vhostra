import { useState } from 'react'

export function CliIntegration({ appImage = false }: { appImage?: boolean }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const run = async (action: 'installCli' | 'removeCli') => {
    setBusy(true); setMessage('')
    try { setMessage(await window.vhostra![action]()) }
    catch { setMessage('CLI integration could not be changed. Try again.') }
    finally { setBusy(false) }
  }
  return <section className="mt-6 rounded-lg border border-[#E5E5E5] p-4" aria-label="Command-line tool">
    <h2 className="text-lg font-medium">Command-line tool</h2>
    <p className="mt-2 text-sm leading-5 text-[#606060]">{appImage ? 'AppImage users can install a small command wrapper in ~/.local/bin if that directory is already on PATH. Remove it here before deleting or moving the AppImage.' : 'Vhostra adds its command to new terminal sessions when installed in Applications. Remove the Vhostra-owned link here before moving the app to Trash.'}</p>
    <div className="mt-4 flex flex-wrap gap-3">
      <button disabled={busy} onClick={() => void run('installCli')} className="h-9 rounded-full bg-[#FF0000] px-4 text-sm font-medium text-white disabled:opacity-50">Install CLI</button>
      <button disabled={busy} onClick={() => void run('removeCli')} className="h-9 rounded-full border border-[#E5E5E5] px-4 text-sm font-medium disabled:opacity-50">Remove CLI</button>
    </div>
    {message && <p role="status" className="mt-4 text-sm">{message}</p>}
  </section>
}
