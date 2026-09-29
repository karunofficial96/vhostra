import { Undo2, Redo2, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { HostsEditReview, HostsFileSnapshot, VhostraDesktopApi } from '../types/desktop-api'

type Mapping = Awaited<ReturnType<VhostraDesktopApi['allHostsStatus']>>
const button = 'h-9 rounded-full border border-[#E5E5E5] px-4 text-sm font-medium disabled:opacity-50'
export function HostsEditor({ onSaved }: { onSaved?: () => Promise<void> }) {
  const [file, setFile] = useState<HostsFileSnapshot | null>(null)
  const [draft, setDraft] = useState(''); const [previousDraft, setPreviousDraft] = useState<string | null>(null)
  const [editing, setEditing] = useState(false); const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null); const [failed, setFailed] = useState(false)
  const [review, setReview] = useState<HostsEditReview | null>(null); const [mappings, setMappings] = useState<Mapping | null>(null)
  const [history, setHistory] = useState<string[]>([]); const [cursor, setCursor] = useState(0)
  const clearHistory = () => { setHistory([]); setCursor(0) }
  const change = (value: string) => {
    if (value.length > 1024 * 1024) { setFailed(true); setMessage('Hosts editor text exceeds the 1 MiB limit.'); return }
    let next = [...history.slice(0, cursor + 1), value]
    while (next.length > 100 || (next.length > 1 && next.reduce((sum, item) => sum + item.length * 2, 0) > 8 * 1024 * 1024)) next.shift()
    setHistory(next); setCursor(next.length - 1); setDraft(value); setReview(null)
  }
  const move = (position: number) => { setCursor(position); setDraft(history[position]); setReview(null) }
  const recover = async () => {
    if (!file) return
    setBusy(true); setMessage(null)
    try { const next = await window.vhostra!.previewPreviousHosts(file.contents); change(next.contents); setReview(next); setFailed(false) }
    catch (reason) { setMessage(String(reason)); setFailed(true) } finally { setBusy(false) }
  }
  const dialog = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!review) return
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) { event.preventDefault(); setReview(null) }
      if (event.key === 'Tab') {
        const buttons = [...(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
        const first = buttons[0]; const last = buttons.at(-1)
        if (!first) event.preventDefault()
        else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('keydown', keydown); previous?.focus() }
  }, [review, busy])
  const inspect = async (reload = false) => {
    setBusy(true)
    try {
      const next = await window.vhostra!.inspectHosts()
      if (reload && editing && file && draft !== file.contents) setPreviousDraft(draft)
      clearHistory(); setFile(next); setDraft(next.contents); setEditing(false); setReview(null); setFailed(false)
      setMessage(reload ? 'Current Hosts file reloaded. Your previous draft is retained below for copying and merging; it will not be applied automatically.' : null)
      setMappings(await window.vhostra!.allHostsStatus())
    } catch (reason) { setMessage(String(reason)); setFailed(true) } finally { setBusy(false) }
  }
  const preview = async () => {
    if (!file) return
    setBusy(true); setMessage(null); setFailed(false)
    try { setReview(await window.vhostra!.previewHostsEdit(draft, file.contents)) }
    catch (reason) { setMessage(String(reason)); setFailed(true) } finally { setBusy(false) }
  }
  const save = async () => {
    if (!file || !review) return
    setBusy(true); setMessage('Waiting for scoped administrator approval…'); setFailed(false)
    try {
      const next = await window.vhostra!.editHosts(review.contents, file.contents, review.id)
      clearHistory(); setFile(next); setDraft(next.contents); setEditing(false); setReview(null); setPreviousDraft(null)
      setMessage('Hosts file saved and verified. Site mappings have been recalculated; no automatic repair was performed.')
      // Read-only status refresh. Intentional deletions remain missing until Repair.
      try { setMappings(await window.vhostra!.allHostsStatus()); await onSaved?.() }
      catch (reason) { setMessage(`Hosts file saved and verified, but status refresh failed. Reload to refresh: ${String(reason)}`); setFailed(true) }
    } catch (reason) { setReview(null); setMessage(String(reason)); setFailed(true) } finally { setBusy(false) }
  }
  return <section className="mx-auto mb-8 max-w-[1200px] px-6 lg:px-8"><div className="rounded-lg border border-[#E5E5E5] p-4">
    <h2 className="text-xl font-medium">Hosts file</h2>
    <p className="mt-2 text-sm leading-5 text-[#606060]">Inspect without elevation. This manual editor can change the complete Hosts file, including comments and entries managed by you or other applications. Automatic Site management only changes Vhostra-owned mappings. Saving requires review, confirmation and administrator approval for this write only.</p>
    <button disabled={busy} onClick={() => void inspect(Boolean(file))} className={`${button} mt-4`}>{file ? 'Reload current file' : 'Inspect Hosts file'}</button>
    {file && <>
      <p className="mt-4 break-all font-mono text-xs text-[#606060]">{file.path}</p>
      <p className="mt-2 text-xs leading-5 text-[#606060]">Vhostra-managed mappings have a “# Vhostra” comment followed by a UUID. Changing them can leave Sites missing or conflicting; use Sites → Repair when you want to restore a mapping.</p>
      {file.managedLines.length > 0 && <details className="mt-3 text-xs"><summary className="cursor-pointer font-medium">Vhostra-managed lines ({file.managedLines.length})</summary><ul className="mt-2 space-y-1">{file.managedLines.map(line => <li key={line.line} className="break-all font-mono">Line {line.line}: {line.hostnames.join(', ')}</li>)}</ul></details>}
      <textarea maxLength={1024 * 1024} aria-label="Hosts file contents" readOnly={!editing || busy} value={draft} onChange={event => { const kind = (event.nativeEvent as InputEvent).inputType; if (kind === 'historyUndo') { if (cursor > 0) move(cursor - 1); else event.currentTarget.value = draft } else if (kind === 'historyRedo') { if (cursor < history.length - 1) move(cursor + 1); else event.currentTarget.value = draft } else change(event.target.value) }} onKeyDown={event => { if (editing && !busy && (event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y')) { event.preventDefault(); const redo = event.shiftKey || event.key.toLowerCase() === 'y'; if (redo ? cursor < history.length - 1 : cursor > 0) move(cursor + (redo ? 1 : -1)) } }} spellCheck={false} className="input mt-3 min-h-64 w-full resize-y whitespace-pre font-mono text-xs"/>
      <div className="mt-4 flex flex-wrap gap-3">{editing ? <><button disabled={busy || cursor === 0} onClick={() => move(cursor - 1)} className={`${button} inline-flex items-center gap-2`}><Undo2 size={16}/>Undo</button><button disabled={busy || cursor >= history.length - 1} onClick={() => move(cursor + 1)} className={`${button} inline-flex items-center gap-2`}><Redo2 size={16}/>Redo</button><button disabled={busy || draft === file.contents} onClick={() => change(file.contents)} className={`${button} inline-flex items-center gap-2`}><RotateCcw size={16}/>Restore Original</button><button disabled={busy} onClick={() => void recover()} className={button}>Restore Previous Hosts File</button><button disabled={busy} onClick={() => { clearHistory(); setDraft(file.contents); setEditing(false); setReview(null); setMessage(null); setFailed(false) }} className={button}>Cancel</button><button disabled={busy || draft === file.contents} onClick={() => void preview()} className="h-9 rounded-full bg-[#FF0000] px-4 text-sm font-medium text-white disabled:opacity-50">Review changes</button></> : <button disabled={busy} onClick={() => { setHistory([file.contents]); setCursor(0); setEditing(true); setMessage(null); setFailed(false) }} className={button}>Edit complete Hosts file</button>}</div>
    </>}
    {message && <div role={failed ? 'alert' : 'status'} className={`mt-4 text-sm leading-5 ${failed ? 'text-[#B00020]' : 'text-[#606060]'}`}><p className="break-words">{message}</p>{failed && file && <button disabled={busy} onClick={() => void inspect(true)} className={`${button} mt-3 text-[#0F0F0F]`}>Reload current file and review</button>}</div>}
    {previousDraft !== null && <details className="mt-4"><summary className="cursor-pointer text-sm font-medium">Previous unsaved draft — copy edits into the reloaded file</summary><textarea aria-label="Previous Hosts draft" readOnly value={previousDraft} className="input mt-3 min-h-48 w-full resize-y font-mono text-xs"/></details>}
    {mappings && <div className="selectable mt-4 border-t border-[#E5E5E5] pt-4"><h3 className="text-sm font-medium">Site mapping status</h3>{mappings.length ? <ul className="mt-2 space-y-1 text-xs">{mappings.map((mapping, index) => <li key={`${mapping.hostname}-${index}`} className="break-all">{mapping.hostname} — {mapping.state === 'required' ? 'Missing' : mapping.state === 'conflict' ? `Conflict (${mapping.address})` : 'Mapped'}</li>)}</ul> : <p className="mt-2 text-xs text-[#606060]">No custom Site mappings to check.</p>}</div>}
  </div>
  {review && <div role="dialog" aria-modal="true" aria-labelledby="hosts-review-title" className="fixed inset-0 z-50 grid place-items-center overflow-auto bg-black/40 p-6"><div ref={dialog} className="my-auto w-full max-w-[800px] rounded-lg bg-white p-6 shadow-xl">
    <h2 id="hosts-review-title" className="text-xl font-medium">Review Hosts file changes</h2>
    <p className="mt-4 text-sm leading-5 text-[#606060]">The diff removes {review.removedLines} line(s) and adds {review.addedLines} line(s). “−” removes text; “+” adds text. Review the complete draft before confirming. Administrator approval is required; a private recovery backup is created before writing.</p>
    <p className="selectable mt-3 text-xs leading-5 text-[#606060]">Mappings: {review.mappingChanges.added} added · {review.mappingChanges.removed} removed · {review.mappingChanges.modified} modified · {review.mappingChanges.manual} manual/unrelated changes. Comment additions/removals: {review.commentsChanged}.</p>{review.managedChanges.length > 0 && <div role="alert" className="mt-4 rounded-lg border border-[#FB8C00] p-4"><p className="text-sm font-medium">Vhostra-managed mappings will change or be deleted</p><p className="mt-2 text-sm leading-5 text-[#606060]">Corresponding Site hostnames or aliases may become missing or conflicting. Vhostra will show their status and will only restore them when you choose Repair.</p><ul className="mt-2 max-h-24 overflow-auto text-xs">{review.managedChanges.map((line, index) => <li key={index} className="break-all">{line}</li>)}</ul></div>}
    <pre aria-label="Hosts changes diff" className="mt-4 max-h-64 overflow-auto rounded-lg bg-[#F2F2F2] p-4 font-mono text-xs leading-5">{review.diff}</pre>
    {review.truncated && <p className="mt-3 text-sm text-[#606060]">Diff preview is truncated at 128 KiB. Return to the editor to inspect the complete proposed file.</p>}
    <div className="mt-6 flex flex-wrap justify-end gap-3"><button disabled={busy} onClick={() => setReview(null)} className={button}>Back to Edit</button><button disabled={busy} onClick={() => { setReview(null); clearHistory(); setDraft(file!.contents); setEditing(false) }} className={button}>Cancel</button><button disabled={busy} onClick={() => void save()} className="h-9 rounded-full bg-[#FF0000] px-4 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save Changes'}</button></div>
  </div></div>}
  </section>
}
