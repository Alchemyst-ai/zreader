/**
 * DOM side of anchoring: map between Ranges and chapter text offsets,
 * resolve stored anchors, paint highlights (CSS Custom Highlight API) and
 * hit-test taps. Never mutates the content DOM, so it is
 * safe with React-rendered (MDX) and server-rendered (HTML) chapters alike.
 */
import { quoteFor, resolveInText, sentenceAt, snapToWords, type TextSpan } from "./text";
import { BLOCK_TAGS, createBlockIdAllocator, createSlugger, normalizeBlockText } from "./blocks";
import type { Anchor, Highlight, TocEntry } from "./types";

export const BLOCK_ATTR = "data-block-id";
export const IGNORE_ATTR = "data-zr-ignore";

interface Entry {
  node: Text;
  start: number;
  end: number;
}

export interface TextIndex {
  root: Element;
  text: string;
  entries: Entry[];
}

const BLOCK_SELECTOR = Array.from(BLOCK_TAGS).join(",");
const HEADING_TAG = /^H([1-6])$/;

/**
 * Give blocks and headings the ids the build-time plugin would have given them
 * (`zreader/rehype`), for content rendered without it: MDX compiled
 * by your bundler, JSX, third-party HTML. Same traversal order, same hash, so ids
 * match either way. No-op when the content already carries block ids.
 * Only adds attributes; never changes text or structure.
 */
export function ensureBlockIds(root: Element): { assigned: number } {
  if (root.querySelector(`[${BLOCK_ATTR}]`)) return { assigned: 0 };
  const allocate = createBlockIdAllocator();
  const slugger = createSlugger();
  let assigned = 0;
  for (const el of Array.from(root.querySelectorAll(BLOCK_SELECTOR))) {
    const text = normalizeBlockText(el.textContent ?? "");
    if (HEADING_TAG.test(el.tagName)) {
      const existing = el.getAttribute("id");
      if (existing) slugger.keep(existing);
      else el.setAttribute("id", slugger.slug(text));
    }
    if (el.querySelector(BLOCK_SELECTOR)) continue; // only innermost blocks are anchors
    if (!text) continue;
    el.setAttribute(BLOCK_ATTR, allocate(el.tagName, text));
    assigned++;
  }
  return { assigned };
}

/** Table of contents from the headings in `root` (those with an `id`). */
export function collectToc(root: Element, depth: [min: number, max: number] = [2, 3]): TocEntry[] {
  const out: TocEntry[] = [];
  for (const el of Array.from(root.querySelectorAll("h1,h2,h3,h4,h5,h6"))) {
    const d = Number(HEADING_TAG.exec(el.tagName)?.[1] ?? 0);
    const id = el.getAttribute("id");
    const text = normalizeBlockText(el.textContent ?? "");
    if (id && text && d >= depth[0] && d <= depth[1]) out.push({ id, depth: d, text });
  }
  return out;
}

export function buildTextIndex(root: Element): TextIndex {
  const entries: Entry[] = [];
  let text = "";
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return 2; // FILTER_REJECT
      if (parent.closest(`[${IGNORE_ATTR}],script,style,noscript,template`)) return 2;
      return 1; // FILTER_ACCEPT
    },
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    const len = t.data.length;
    if (!len) continue;
    entries.push({ node: t, start: text.length, end: text.length + len });
    text += t.data;
  }
  return { root, text, entries };
}

/** Text offset of a DOM boundary point. */
export function pointToOffset(index: TextIndex, container: Node, offset: number): number {
  if (container.nodeType === 3) {
    const e = index.entries.find((x) => x.node === container);
    if (e) return e.start + Math.min(offset, e.end - e.start);
  }
  // Element (or ignored text) boundary: first indexed text node at/after the point.
  const doc = index.root.ownerDocument;
  const probe = doc.createRange();
  probe.setStart(container, offset);
  probe.collapse(true);
  let lo = 0;
  let hi = index.entries.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const node = index.entries[mid]!.node;
    // comparePoint returns -1 if the point (node,0) is before the probe.
    let cmp: number;
    try {
      cmp = probe.comparePoint(node, 0);
    } catch {
      cmp = 1;
    }
    if (cmp < 0 && !(container.nodeType === 3 && node === container)) lo = mid + 1;
    else hi = mid;
  }
  // If the boundary is inside the text node at lo-1 (e.g. ignored sibling), clamp to its end.
  return lo < index.entries.length ? index.entries[lo]!.start : index.text.length;
}

export function offsetToPoint(index: TextIndex, offset: number, preferNext = false): { node: Text; offset: number } | null {
  const { entries } = index;
  if (!entries.length) return null;
  let lo = 0;
  let hi = entries.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (entries[mid]!.end < offset || (preferNext && entries[mid]!.end === offset)) lo = mid + 1;
    else hi = mid;
  }
  const e = entries[lo]!;
  return { node: e.node, offset: Math.max(0, Math.min(offset - e.start, e.end - e.start)) };
}

export function rangeToSpan(index: TextIndex, range: Range): TextSpan | null {
  if (!index.root.contains(range.commonAncestorContainer) && range.commonAncestorContainer !== index.root) {
    // Clip to root.
    const r = range.cloneRange();
    try {
      if (!index.root.contains(r.startContainer)) r.setStart(index.root, 0);
      if (!index.root.contains(r.endContainer)) r.setEnd(index.root, index.root.childNodes.length);
    } catch {
      return null;
    }
    range = r;
  }
  const start = pointToOffset(index, range.startContainer, range.startOffset);
  const end = pointToOffset(index, range.endContainer, range.endOffset);
  return end > start ? { start, end } : null;
}

export function spanToRange(index: TextIndex, span: TextSpan): Range | null {
  const a = offsetToPoint(index, span.start, true);
  const b = offsetToPoint(index, span.end);
  if (!a || !b) return null;
  const r = index.root.ownerDocument.createRange();
  r.setStart(a.node, a.offset);
  r.setEnd(b.node, b.offset);
  return r;
}

export function blockElementAt(index: TextIndex, offset: number): Element | null {
  const p = offsetToPoint(index, offset, true);
  return p?.node.parentElement?.closest(`[${BLOCK_ATTR}]`) ?? null;
}

/** Text span covered by a block element. */
export function blockSpan(index: TextIndex, el: Element): TextSpan | null {
  let start = -1;
  let end = -1;
  for (const e of index.entries) {
    if (el.contains(e.node)) {
      if (start < 0) start = e.start;
      end = e.end;
    } else if (start >= 0) break;
  }
  return start < 0 ? null : { start, end };
}

export function findBlock(root: Element, blockId: string): Element | null {
  const esc = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(blockId) : blockId.replace(/"/g, '\\"');
  return root.querySelector(`[${BLOCK_ATTR}="${esc}"]`);
}

export function describeSpan(index: TextIndex, span: TextSpan, contentHash?: string): Anchor | null {
  const block = blockElementAt(index, span.start);
  if (!block) return null;
  const bs = blockSpan(index, block);
  const q = quoteFor(index.text, span.start, span.end);
  return {
    blockId: block.getAttribute(BLOCK_ATTR) ?? "",
    blockStart: span.start - (bs?.start ?? 0),
    start: span.start,
    end: span.end,
    ...q,
    ...(contentHash ? { contentHash } : {}),
  };
}

export function resolveAnchor(index: TextIndex, anchor: Anchor): TextSpan | null {
  const block = anchor.blockId ? findBlock(index.root, anchor.blockId) : null;
  const bs = block ? blockSpan(index, block) : null;
  return resolveInText(index.text, anchor, bs?.start);
}

/** Selection → word-snapped span inside root, or null. */
export function selectionSpan(index: TextIndex, selection: Selection | null): TextSpan | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!index.root.contains(range.commonAncestorContainer) && !range.intersectsNode(index.root)) return null;
  const span = rangeToSpan(index, range);
  if (!span) return null;
  const snapped = snapToWords(index.text, span.start, span.end);
  return snapped.end > snapped.start ? snapped : null;
}

/** Sentence (chapter-relative span) at a chapter text offset. */
export function sentenceSpanAt(index: TextIndex, offset: number, locale?: string): TextSpan | null {
  const block = blockElementAt(index, offset);
  const bs = block ? blockSpan(index, block) : { start: 0, end: index.text.length };
  if (!bs) return null;
  const local = sentenceAt(index.text.slice(bs.start, bs.end), offset - bs.start, locale);
  return local.end > local.start ? { start: bs.start + local.start, end: bs.start + local.end } : null;
}

/** Expand a chapter-relative span to whole sentences (within the start and end blocks). */
export function expandSpanToSentences(index: TextIndex, span: TextSpan, locale?: string): TextSpan {
  const a = sentenceSpanAt(index, span.start, locale);
  const b = sentenceSpanAt(index, Math.max(span.start, span.end - 1), locale);
  return { start: Math.min(a?.start ?? span.start, b?.start ?? span.start), end: Math.max(a?.end ?? span.end, b?.end ?? span.end) };
}

/** Chapter text offset under a viewport point (tap / click). */
export function offsetFromPoint(index: TextIndex, x: number, y: number): number | null {
  const doc = index.root.ownerDocument as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  let node: Node | null = null;
  let off = 0;
  if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y);
    if (p) {
      node = p.offsetNode;
      off = p.offset;
    }
  } else if (doc.caretRangeFromPoint) {
    const r = doc.caretRangeFromPoint(x, y);
    if (r) {
      node = r.startContainer;
      off = r.startOffset;
    }
  }
  if (!node || !index.root.contains(node)) return null;
  return pointToOffset(index, node, off);
}

// ------------------------------------------------------------- painting

export interface ResolvedHighlight {
  highlight: Highlight;
  span: TextSpan;
  range: Range;
}

export function supportsHighlightApi(): boolean {
  return typeof CSS !== "undefined" && "highlights" in CSS && typeof (globalThis as { Highlight?: unknown }).Highlight === "function";
}

type HighlightRegistry = Map<string, unknown>;
type HighlightCtor = new (...ranges: Range[]) => unknown;

/** Registry names used for painting: `::highlight(zr-<color>)` and `::highlight(zr-active)`. */
export function highlightName(color: string, namespace = "zr"): string {
  return `${namespace}-${color}`;
}

/**
 * Paint highlights with the CSS Custom Highlight API. The DOM is never mutated
 * and no inline styles are written; colours come from `::highlight()` rules in
 * the stylesheet. Returns a cleanup function (no-op where unsupported).
 */
export function paintHighlights(
  resolved: ResolvedHighlight[],
  opts: { activeId?: string | null; namespace?: string } = {},
): () => void {
  if (!supportsHighlightApi()) return () => {};
  const ns = opts.namespace ?? "zr";
  const byName = new Map<string, Range[]>();
  for (const r of resolved) {
    const name = highlightName(r.highlight.id === opts.activeId ? "active" : r.highlight.color, ns);
    const list = byName.get(name) ?? [];
    list.push(r.range);
    byName.set(name, list);
  }
  const registry = (CSS as unknown as { highlights: HighlightRegistry }).highlights;
  const Ctor = (globalThis as unknown as { Highlight: HighlightCtor }).Highlight;
  for (const [name, ranges] of byName) registry.set(name, new Ctor(...ranges));
  return () => byName.forEach((_, name) => registry.delete(name));
}

export function highlightAtOffset(resolved: ResolvedHighlight[], offset: number): ResolvedHighlight | null {
  // Prefer the shortest highlight covering the offset (most specific).
  let best: ResolvedHighlight | null = null;
  for (const r of resolved) {
    if (offset >= r.span.start && offset < r.span.end) {
      if (!best || r.span.end - r.span.start < best.span.end - best.span.start) best = r;
    }
  }
  return best;
}
