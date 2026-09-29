import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { RuntimeSnapshot } from '../types/domain'

export function RuntimeProgress({ runtime }: { runtime: RuntimeSnapshot | null }) {
  const [expanded, setExpanded] = useState(false)
  const viewport = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const progress = runtime?.progress
  useEffect(() => { setExpanded(false); following.current = true }, [progress?.id])
  useEffect(() => {
    if (expanded && following.current && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight
  }, [expanded, progress?.lines])
  if (!progress) return null
  return <div className="runtime-progress">
    <button className="runtime-expand" aria-expanded={expanded} aria-controls="runtime-terminal" onClick={() => setExpanded(value => !value)}>
      {expanded ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}{expanded ? 'Collapse' : 'Expand'} runtime details
    </button>
    {expanded && <>
      <div id="runtime-terminal" ref={viewport} className="runtime-terminal" role="region" aria-label="Live runtime operation output" tabIndex={0}
        onScroll={() => { const node = viewport.current; if (node) following.current = node.scrollHeight - node.scrollTop - node.clientHeight < 24 }}>
        {progress.lines.map((line, index) => <div key={index} className={`runtime-line ${/error|failed|rollback/i.test(line) ? 'runtime-line-error' : line.startsWith('✓') ? 'runtime-line-success' : ''}`}>{line}</div>)}
      </div>
      <button className="runtime-expand" onClick={() => { following.current = true; if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight }}>Follow latest output</button>
    </>}
  </div>
}
