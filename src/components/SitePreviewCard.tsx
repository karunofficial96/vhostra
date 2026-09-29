import { useEffect, useRef, useState } from 'react'
import { ExternalLink, Globe2 } from 'lucide-react'
import type { Site } from '../types/domain'
import { redactProgress } from '../../electron/progress'

type Result = Awaited<ReturnType<NonNullable<Window['vhostra']>['capturePreview']>>
export function SitePreviewCard({ site, ready, openSite }: { site: Site; ready: boolean; openSite: (url: string) => void }) {
  const [preview, setPreview] = useState(site.screenshot)
  const [failedImage, setFailedImage] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)
  const invalidImageAttempt = useRef(''); const busy = useRef(false); const mounted = useRef(true)
  const capture = async (force = false) => {
    if (!mounted.current || busy.current || document.visibilityState !== 'visible') return
    busy.current = true; setCapturing(true); setSuccess(null)
    try {
      await window.vhostra?.setPreviewActivity(true)
      const next = await window.vhostra?.capturePreview(site.id, force)
      if (!mounted.current || !next) return
      setResult(next)
      if (next.captured && force) setSuccess(next.message)
      if (next.screenshot) { setPreview(next.screenshot); setFailedImage(false) }
    } catch (error) { if (mounted.current) setResult({ captured: false, message: 'Preview could not be generated.', details: redactProgress(String(error)) }) }
    finally { busy.current = false; if (mounted.current) setCapturing(false) }
  }
  useEffect(() => { if (!success) return; const timer = setTimeout(() => setSuccess(null), 6000); return () => clearTimeout(timer) }, [success])
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { setPreview(site.screenshot); setFailedImage(false); setResult(null) }, [site.id, site.url, site.documentRoot, site.updatedAt, site.screenshot?.capturedAt])
  useEffect(() => {
    const visible = () => { if (ready && document.visibilityState === 'visible') void capture() }
    let disposed = false; queueMicrotask(() => { if (!disposed) visible() }); document.addEventListener('visibilitychange', visible)
    return () => { disposed = true; document.removeEventListener('visibilitychange', visible) }
  }, [site.id, site.url, site.documentRoot, site.updatedAt, site.screenshot?.capturedAt, ready])
  const repair = async () => {
    if (busy.current) return
    busy.current = true; setCapturing(true)
    try { await window.vhostra?.repairSite(site.vhostId) }
    catch (error) { setResult({ captured: false, message: 'Site repair could not be completed.', details: redactProgress(String(error)), repair: true }); return }
    finally { busy.current = false; setCapturing(false) }
    await capture(true)
  }
  const screenshot = preview && !failedImage ? `vhostra-screenshot://site/${site.id}?v=${encodeURIComponent(preview.capturedAt)}` : null
  const message = result && !result.captured && !result.screenshot ? result.message : !ready ? 'The web server is stopped.' : 'Refresh Preview to capture this Site.'
  return <article className="min-w-0 border-b border-[#E5E5E5] pb-4" data-preview-site={site.id}>
    <button aria-label={`Open ${site.name} in your default browser`} onClick={() => openSite(site.url)} className="mb-3 flex aspect-video w-full items-center justify-center overflow-hidden rounded-xl bg-[#F2F2F2] text-[#606060] hover:opacity-90">
      {screenshot ? <img src={screenshot} alt={`${site.name} local site preview`} onError={() => { setFailedImage(true); if (ready && preview && invalidImageAttempt.current !== preview.capturedAt) { invalidImageAttempt.current = preview.capturedAt; void capture() } }} className="h-full w-full object-cover object-top"/> : <div className="p-4 text-center"><Globe2 className="mx-auto mb-2" size={28}/><span className="text-xs font-medium">{capturing ? 'Generating local preview…' : 'Preview could not be generated.'}</span></div>}
    </button>
    {!screenshot && !capturing && <p className="selectable mb-3 text-xs leading-5 text-[#606060]">{message}</p>}
    <div className="mb-3 flex flex-wrap gap-3"><button disabled={capturing} onClick={() => void capture(true)} className="h-9 rounded-full border border-[#E5E5E5] px-4 text-sm font-medium disabled:opacity-50">{capturing ? 'Capturing…' : 'Refresh Preview'}</button>{result?.repair && !site.builtIn && <button disabled={capturing} onClick={() => void repair()} className="h-9 rounded-full border border-[#E5E5E5] px-4 text-sm font-medium disabled:opacity-50">Repair Site</button>}</div>
    {success && <p role="status" className="selectable-message mb-3 text-xs text-[#2BA640]">{success}</p>}
    {result && !result.captured && !result.screenshot && screenshot && <p className="selectable mb-3 text-xs text-[#606060]">Preview could not be refreshed. {result.message} The previous preview is retained.</p>}
    {result?.details && <details className="mb-4 text-xs text-[#606060]"><summary className="cursor-pointer font-medium">Show details</summary><pre className="selectable mt-4 whitespace-pre-wrap break-all rounded-lg bg-[#F2F2F2] p-4 font-mono">{result.details}</pre></details>}
    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="truncate text-base font-medium">{site.name}</h3><button onClick={() => openSite(site.url)} className="mt-1 inline-flex max-w-full items-center gap-1 text-sm text-[#065FD4] hover:underline"><span className="selectable truncate">{site.url}</span><ExternalLink size={14}/></button><p className="selectable mt-1 truncate font-mono text-xs text-[#606060]">{site.documentRoot}</p></div><button aria-label={`Open ${site.name} in default browser`} onClick={() => openSite(site.url)} className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[#606060] hover:bg-[#F2F2F2]"><ExternalLink size={18}/></button></div>
    {preview?.url && <details className="mt-3 text-xs text-[#606060]"><summary className="cursor-pointer font-medium">Preview information</summary><dl className="mt-4"><dt className="font-medium">Preview URL</dt><dd className="selectable mt-2 break-all font-mono">{preview.url}</dd></dl></details>}
  </article>
}
