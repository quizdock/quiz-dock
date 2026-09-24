/**
 * The byte span a `Range` request asks for, or why it cannot be served.
 *
 * Safari will not play a video it cannot seek into: it opens with
 * `Range: bytes=0-1` and gives up on a plain `200`. One span is all a media
 * element ever asks for, so a multi-range request is answered with the whole
 * file (RFC 9110 allows ignoring `Range`), and anything unparsable too.
 */
export type ByteRange = { start: number; end: number } | 'unsatisfiable' | null;

export function parseRange(header: string | undefined, size: number): ByteRange {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, from, to] = m;
  if (from === '' && to === '') return null;
  if (from === '') {
    // Suffix form: the last N bytes.
    const suffix = Number(to);
    if (suffix === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(from);
  if (start >= size) return 'unsatisfiable';
  const end = to === '' ? size - 1 : Math.min(Number(to), size - 1);
  if (end < start) return null;
  return { start, end };
}
