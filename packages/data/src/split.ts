/**
 * Text splitter: paragraph-first, then recursive fallback.
 * Chunk size is character-based (500 with 50 overlap) per the design doc.
 */

export interface SplitOptions {
  /** Target chunk size in characters. */
  size?: number;
  /** Overlap between consecutive chunks, in characters. */
  overlap?: number;
}

const DEFAULT_SIZE = 500;
const DEFAULT_OVERLAP = 50;

const SEPARATORS = ["\n\n", "\n", "。", "！", "？", ". ", "! ", "? ", "；", "; ", " "];

function splitBySeparator(text: string, separator: string): string[] {
  return text
    .split(separator)
    .map((part, i, arr) => (i < arr.length - 1 ? part + separator : part))
    .filter((part) => part.length > 0);
}

function recursiveSplit(text: string, size: number, depth = 0): string[] {
  if (text.length <= size) return [text];
  if (depth >= SEPARATORS.length) {
    // No separator left: hard cut.
    const out: string[] = [];
    for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
    return out;
  }

  const separator = SEPARATORS[depth];
  if (!separator) return [text];

  const parts = splitBySeparator(text, separator);
  if (parts.length <= 1) return recursiveSplit(text, size, depth + 1);

  const chunks: string[] = [];
  let buffer = "";
  for (const part of parts) {
    if (part.length > size) {
      if (buffer) {
        chunks.push(buffer);
        buffer = "";
      }
      chunks.push(...recursiveSplit(part, size, depth + 1));
      continue;
    }
    if (buffer && buffer.length + part.length > size) {
      chunks.push(buffer);
      buffer = part;
    } else {
      buffer += part;
    }
  }
  if (buffer) chunks.push(buffer);
  return chunks;
}

/** Join chunks back with the requested overlap window. */
function applyOverlap(chunks: string[], size: number, overlap: number): string[] {
  if (overlap <= 0 || chunks.length <= 1) return chunks;
  const out: string[] = [];
  for (let i = 0; i < chunks.length; i += 1) {
    const current = chunks[i] ?? "";
    if (i === 0) {
      out.push(current);
      continue;
    }
    const prev = chunks[i - 1] ?? "";
    const tail = prev.slice(Math.max(0, prev.length - overlap));
    const merged = `${tail}${current}`;
    out.push(merged.length > size * 1.5 ? current : merged);
  }
  return out;
}

/** Split raw text into retrieval-friendly chunks. */
export function splitText(text: string, options: SplitOptions = {}): string[] {
  const size = options.size ?? DEFAULT_SIZE;
  const overlap = options.overlap ?? DEFAULT_OVERLAP;
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const chunks = recursiveSplit(normalized, size);
  return applyOverlap(chunks, size, overlap)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}
