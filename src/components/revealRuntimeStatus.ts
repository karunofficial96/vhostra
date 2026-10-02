/** Reveal a completed user operation in its own scroll pane, once after render. */
export function revealRuntimeStatus(target: HTMLElement | null) {
  if (!target) return
  const pane = target.closest<HTMLElement>('.overflow-auto')
  if (!pane || !pane.contains(target) || pane.scrollHeight <= pane.clientHeight) return
  const section = target.getBoundingClientRect()
  const viewport = pane.getBoundingClientRect()
  if (section.top >= viewport.top + 8 && section.bottom <= viewport.bottom - 8) return
  // scrollIntoView can move several ancestors. Move only this view's content pane.
  pane.scrollTo({ top: pane.scrollTop + section.top - viewport.top - 24, behavior: 'smooth' })
}
