/** Patience anchors keep independent edits readable without quadratic full-file LCS. */
export function hostsDiff(source: string, proposed: string) {
  const before = source.match(/[^\n]*\n|[^\n]+$/g) ?? []; const after = proposed.match(/[^\n]*\n|[^\n]+$/g) ?? []
  const occurrences = (lines: string[]) => { const values = new Map<string, number[]>(); lines.forEach((line, index) => { const positions = values.get(line); if (positions) positions.push(index); else values.set(line, [index]) }); return values }
  const old = occurrences(before); const next = occurrences(after)
  const matches = before.flatMap((line, index) => old.get(line)?.length === 1 && next.get(line)?.length === 1 ? [{ old: index, next: next.get(line)![0] }] : [])
  const tails: number[] = []; const previous: number[] = []
  matches.forEach((match, index) => { let low = 0; let high = tails.length; while (low < high) { const middle = (low + high) >>> 1; if (matches[tails[middle]].next < match.next) low = middle + 1; else high = middle }; previous[index] = low ? tails[low - 1] : -1; tails[low] = index })
  const anchors: typeof matches = []; for (let index = tails.at(-1) ?? -1; index >= 0; index = previous[index]) anchors.push(matches[index]); anchors.reverse(); anchors.push({ old: before.length, next: after.length })
  let oldStart = 0; let newStart = 0; let removedLines = 0; let addedLines = 0; const chunks: string[] = []
  const line = (prefix: string, value: string) => `${prefix}${value.replace(/\r?\n$/, '')}\n${value.endsWith('\n') ? '' : '\\ No newline at end of file\n'}`
  for (const anchor of anchors) {
    let oldEnd = anchor.old; let newEnd = anchor.next
    while (oldStart < oldEnd && newStart < newEnd && before[oldStart] === after[newStart]) { oldStart++; newStart++ }
    while (oldEnd > oldStart && newEnd > newStart && before[oldEnd - 1] === after[newEnd - 1]) { oldEnd--; newEnd-- }
    const removed = oldEnd - oldStart; const added = newEnd - newStart
    if (removed || added) { removedLines += removed; addedLines += added; chunks.push(`@@ -${oldStart + 1},${removed} +${newStart + 1},${added} @@\n` + before.slice(oldStart, oldEnd).map(value => line('-', value)).join('') + after.slice(newStart, newEnd).map(value => line('+', value)).join('')) }
    oldStart = anchor.old + 1; newStart = anchor.next + 1
  }
  const bytes = Buffer.from(chunks.join('')); return { diff: bytes.subarray(0, 128 * 1024).toString(), truncated: bytes.length > 128 * 1024, removedLines, addedLines }
}
