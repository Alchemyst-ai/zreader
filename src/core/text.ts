/**
 * Pure, DOM-free text anchoring helpers. Everything here operates on the
 * concatenated text of a chapter so it can be unit-tested in Node.
 */
import search from "approx-string-match";
import type { Anchor } from "./types";

export const CONTEXT_LENGTH = 32;

export interface TextSpan {
  start: number;
  end: number;
}

export function quoteFor(text: string, start: number, end: number) {
  return {
    exact: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT_LENGTH), start),
    suffix: text.slice(end, end + CONTEXT_LENGTH),
  };
}

/** Length of the common suffix of `a` and common prefix of `b`, used to score context. */
function commonSuffixLen(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}
function commonPrefixLen(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

function score(text: string, anchor: Anchor, start: number, end: number, errors = 0): number {
  const prefix = text.slice(Math.max(0, start - CONTEXT_LENGTH), start);
  const suffix = text.slice(end, end + CONTEXT_LENGTH);
  const ctx = commonSuffixLen(prefix, anchor.prefix) + commonPrefixLen(suffix, anchor.suffix);
  const distance = Math.abs(start - anchor.start) / Math.max(1, text.length);
  return ctx * 2 - errors * 4 - distance * 10;
}

export type ResolveStrategy = "position" | "block" | "quote" | "fuzzy";

/**
 * Re-anchor a stored anchor in (possibly edited) chapter text.
 * `blockOffset` is the current text offset of the anchor's block, if it still exists.
 */
export function resolveInText(
  text: string,
  anchor: Anchor,
  blockOffset?: number,
): (TextSpan & { strategy: ResolveStrategy }) | null {
  const { exact } = anchor;
  if (!exact) return null;

  // 1. Position still points at the same quote.
  if (text.slice(anchor.start, anchor.end) === exact) return { start: anchor.start, end: anchor.end, strategy: "position" };

  // 2. Same block, same relative offset.
  if (blockOffset !== undefined) {
    const s = blockOffset + anchor.blockStart;
    if (text.slice(s, s + exact.length) === exact) return { start: s, end: s + exact.length, strategy: "block" };
  }

  // 3. Exact quote elsewhere; disambiguate by context and proximity.
  let best: (TextSpan & { score: number }) | null = null;
  for (let i = text.indexOf(exact); i !== -1; i = text.indexOf(exact, i + 1)) {
    const sc = score(text, anchor, i, i + exact.length);
    if (!best || sc > best.score) best = { start: i, end: i + exact.length, score: sc };
  }
  if (best) return { start: best.start, end: best.end, strategy: "quote" };

  // 4. Fuzzy match for lightly edited passages.
  if (exact.length < 8) return null;
  const maxErrors = Math.min(64, Math.floor(exact.length * 0.15));
  const matches = search(text, exact, maxErrors);
  let fuzzy: (TextSpan & { score: number }) | null = null;
  for (const m of matches) {
    const sc = score(text, anchor, m.start, m.end, m.errors);
    if (!fuzzy || sc > fuzzy.score) fuzzy = { start: m.start, end: m.end, score: sc };
  }
  return fuzzy ? { start: fuzzy.start, end: fuzzy.end, strategy: "fuzzy" } : null;
}

// --------------------------------------------------------------- sentences

type Segment = { index: number; segment: string };

function segmentSentences(text: string, locale?: string): Segment[] {
  const Seg = (Intl as unknown as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (Seg) {
    return [...new Seg(locale, { granularity: "sentence" }).segment(text)].map((s) => ({
      index: s.index,
      segment: s.segment,
    }));
  }
  // Fallback: split after terminal punctuation followed by whitespace.
  const out: Segment[] = [];
  const re = /[^.!?…]*(?:[.!?…]+["'”’)\]]*|$)\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && m[0]) {
    out.push({ index: m.index, segment: m[0] });
  }
  return out;
}

function trimSpan(text: string, start: number, end: number): TextSpan {
  while (start < end && /\s/.test(text[start] ?? "")) start++;
  while (end > start && /\s/.test(text[end - 1] ?? "")) end--;
  return { start, end };
}

/**
 * Sentence containing `offset` within `blockText`. Offsets are block-relative.
 */
export function sentenceAt(blockText: string, offset: number, locale?: string): TextSpan {
  const segs = segmentSentences(blockText, locale);
  const clamped = Math.max(0, Math.min(offset, Math.max(0, blockText.length - 1)));
  for (const s of segs) {
    if (clamped >= s.index && clamped < s.index + s.segment.length) {
      return trimSpan(blockText, s.index, s.index + s.segment.length);
    }
  }
  return trimSpan(blockText, 0, blockText.length);
}

/** Expand a block-relative span so it covers whole sentences. */
export function expandToSentences(blockText: string, start: number, end: number, locale?: string): TextSpan {
  const a = sentenceAt(blockText, start, locale);
  const b = sentenceAt(blockText, Math.max(start, end - 1), locale);
  return { start: Math.min(a.start, b.start), end: Math.max(a.end, b.end) };
}

const WORD = /[\p{L}\p{N}_'’-]/u;

/** Expand a span so it doesn't cut words in half, and trim surrounding whitespace. */
export function snapToWords(text: string, start: number, end: number): TextSpan {
  while (start > 0 && WORD.test(text[start - 1] ?? "") && WORD.test(text[start] ?? "")) start--;
  while (end < text.length && WORD.test(text[end] ?? "") && WORD.test(text[end - 1] ?? "")) end++;
  return trimSpan(text, start, end);
}
