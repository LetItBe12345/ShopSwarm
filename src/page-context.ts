/** Slice original text without ranking, filtering or breaking Unicode code points. */
export function pageTextChunk(tree: string, offset = 0, byteLimit = 6_000): { text: string; offset: number; nextOffset?: number; totalLength: number } {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(byteLimit) || byteLimit < 1) throw new Error('invalid page chunk')
  const points = Array.from(tree)
  if (offset > points.length) throw new Error('page offset exceeds snapshot length')
  let end = offset
  let size = 0
  for (; end < points.length; end++) {
    const bytes = Buffer.byteLength(points[end]!)
    if (size + bytes > byteLimit) break
    size += bytes
  }
  if (end === offset && end < points.length) throw new Error('page byte limit cannot hold one character')
  return { text: points.slice(offset, end).join(''), offset, totalLength: points.length,
    ...(end < points.length ? { nextOffset: end } : {}) }
}
