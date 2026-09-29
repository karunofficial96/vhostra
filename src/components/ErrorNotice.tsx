import { parseError } from '../../electron/errors'
export function ErrorNotice({ error, onDismiss }: { error: unknown; onDismiss?: () => void }) {
  const diagnostic = parseError(error)
  return <div role="alert" className="my-4 rounded-lg border border-[#E5E5E5] p-4 text-sm">
    <div className="flex items-start justify-between gap-4"><p className="selectable font-medium text-[#FF0000]">{diagnostic.title}</p>{onDismiss && <button onClick={onDismiss} className="shrink-0 text-[#065FD4]">Dismiss</button>}</div>
    {diagnostic.explanation && <p className="selectable mt-2 text-[#606060]">{diagnostic.explanation}</p>}
    <details className="mt-4"><summary className="cursor-pointer font-medium">Show details</summary><dl className="mt-4 space-y-4">{diagnostic.details.map(({label,value}) => <div key={label}><dt className="text-xs font-medium text-[#606060]">{label}</dt><dd className="selectable mt-1 whitespace-pre-wrap break-all font-mono text-xs leading-5">{value}</dd></div>)}</dl></details>
  </div>
}
