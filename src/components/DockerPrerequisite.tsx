import { useEffect, useState } from 'react'
import type { DockerPrerequisite as DockerState } from '../types/desktop-api'

export function DockerPrerequisite({ onReady }: { onReady?: () => void }) {
  const [state, setState] = useState<DockerState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { void window.vhostra?.dockerPrerequisite().then(setState).catch(() => { setState({ state: 'broken' }); setError('Docker could not be checked. Try Check Again.') }) }, [])
  const act = async (action: () => Promise<DockerState | null>) => {
    setBusy(true); setError('')
    try { const next = await action(); if (next) { setState(next); if (next.state === 'ready') onReady?.() } }
    catch (reason) { setError(reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : 'Docker could not be checked.') }
    finally { setBusy(false) }
  }
  if (!state || state.state === 'ready') return null
  const missing = state.state === 'missing'
  const stopped = state.state === 'stopped'
  return <section aria-label="Docker setup" className="mt-6 rounded-lg border border-[#E5E5E5] bg-[#F2F2F2] p-4">
    <h2 className="text-xl font-medium">{missing ? 'Docker is required to run Vhostra' : stopped ? 'Docker is installed but is not running' : 'Docker needs attention'}</h2>
    <p className="mt-2 text-sm leading-5 text-[#606060]">{missing ? 'Docker was not found on this computer. Docker is separate third-party software. Install it from the official guide and review its terms, then check again.' : stopped ? 'Start Docker to use Vhostra services.' : state.state === 'timeout' ? 'Docker did not respond in time. Check Docker, then try again.' : 'Docker was found but could not be used. Choose a working installation or repair Docker.'}</p>
    <div className="mt-4 flex flex-wrap gap-3">
      {missing && <button disabled={busy} onClick={() => void act(async () => { await window.vhostra!.installDocker(); return null })} className="h-9 rounded-full bg-[#FF0000] px-4 text-sm font-medium text-white disabled:opacity-50">Install Docker</button>}
      {stopped && <button disabled={busy} onClick={() => void act(() => window.vhostra!.startDocker())} className="h-9 rounded-full bg-[#FF0000] px-4 text-sm font-medium text-white disabled:opacity-50">Start Docker</button>}
      <button disabled={busy} onClick={() => void act(() => window.vhostra!.checkDocker())} className="h-9 rounded-full border border-[#E5E5E5] bg-white px-4 text-sm font-medium disabled:opacity-50">{busy ? 'Checking…' : 'Check Again'}</button>
      {(missing || state.state === 'broken') && <button disabled={busy} onClick={() => void act(() => window.vhostra!.chooseDocker())} className="h-9 rounded-full border border-[#E5E5E5] bg-white px-4 text-sm font-medium disabled:opacity-50">Choose Docker</button>}
      <button disabled={busy} onClick={() => void window.vhostra?.quitApplication('keep-services')} className="h-9 rounded-full border border-[#E5E5E5] bg-white px-4 text-sm font-medium disabled:opacity-50">Quit</button>
    </div>
    {error && <p role="alert" className="mt-4 text-sm text-[#FF0000]">{error}</p>}
    {state.detail && <details className="mt-4 text-xs text-[#606060]"><summary className="cursor-pointer">Show details</summary><p className="mt-4 break-words">{state.detail.slice(0, 300)}</p></details>}
  </section>
}
