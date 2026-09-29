/**
 * Minimal recursive text splitter: split on paragraph boundaries first,
 * then hard-split oversized paragraphs. Good enough for KB ingestion;
 * swap for a smarter splitter later without touching callers.
 */
export function splitText(
  text: string,
  opts: { maxChunkSize?: number; overlap?: number } = {},
): string[] {
  const max = opts.maxChunkSize ?? 500;
  const overlap = opts.overlap ?? 50;
  const paragraphs = text
    .split(/\n{2,}|\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";
  for (const para of paragraphs) {
    if (para.length > max) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let i = 0; i < para.length; i += max - overlap) {
        chunks.push(para.slice(i, i + max));
      }
      continue;
    }
    if ((current + "\n" + para).trim().length > max) {
      if (current) chunks.push(current);
      current = para;
    } else {
      current = current ? `${current}\n${para}` : para;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
