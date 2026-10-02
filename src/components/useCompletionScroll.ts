import { useLayoutEffect, type RefObject } from 'react'

// A completion token is advanced only by an explicit user operation. Layout effects
// see the final notice in the DOM before moving the current tab's scroll pane.
export function useCompletionScroll(target: RefObject<HTMLElement>, completion: number) {
  useLayoutEffect(() => {
    if (!completion || !target.current) return
    let pane = target.current.parentElement
    while (pane && getComputedStyle(pane).overflowY !== 'auto') pane = pane.parentElement
    if (!pane) return
    const position = target.current.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop
    pane.scrollTo({ top: position, behavior: 'instant' })
  }, [target, completion])
}
