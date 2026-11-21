import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  buildTextIndex,
  collectToc,
  describeSpan,
  ensureBlockIds,
  expandSpanToSentences,
  findBlock,
  highlightAtOffset,
  offsetFromPoint,
  paintHighlights,
  resolveAnchor,
  selectionSpan,
  sentenceSpanAt,
  spanToRange,
  spanToText,
  BLOCK_ATTR,
  IGNORE_ATTR,
  type Highlight,
  type ResolvedHighlight,
  type TextIndex,
  type TextSpan,
  type TocEntry,
} from "zreader";
import { useHighlights, useReader, useSettings } from "./context";

export interface SelectionRect {
  top: number;
  left: number;
  bottom: number;
  right: number;
  width: number;
  height: number;
}

export interface SelectionState {
  span: TextSpan;
  /** The selected text, with formulas as `$TeX$` (see `spanToText`). */
  text: string;
  rect: SelectionRect;
}

export interface ResumeState {
  blockId: string;
  percent: number;
}

export interface ChapterEngineOptions {
  bookId: string;
  chapterId: string;
  contentHash?: string;
  /** The chapter root element (pass callback-ref state so remounts re-bind). */
  root: HTMLElement | null;
  /** Scrolling element. `null` = the window (mobile layout). */
  scroller?: HTMLElement | null;
  /** px reserved at the top of the scroll viewport (sticky header). */
  topOffset?: number;
  onHighlightTap?: (id: string) => void;
}

const INTERACTIVE = `a,button,input,textarea,select,summary,label,video,audio,iframe,img[data-zr-zoom],[contenteditable],[${IGNORE_ATTR}]`;

function prefersReducedMotion() {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Tiny external store so only <ReadingProgress> re-renders while scrolling. */
function createValueStore(initial: number) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(v: number) {
      if (Math.abs(v - value) < 0.001) return;
      value = v;
      listeners.forEach((l) => l());
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}
export type ValueStore = ReturnType<typeof createValueStore>;

export function useValueStore(store: ValueStore): number {
  return useSyncExternalStore(store.subscribe, store.get, () => 0);
}

export function useChapterEngine(opts: ChapterEngineOptions) {
  const { bookId, chapterId, contentHash, root: rootEl, scroller: scrollEl = null, topOffset = 64 } = opts;
  const rootRef = useRef(rootEl);
  rootRef.current = rootEl;
  const { store, options } = useReader();
  const [settings] = useSettings();
  const highlights = useHighlights(bookId, chapterId);

  const indexRef = useRef<TextIndex | null>(null);
  const [version, setVersion] = useState(0);
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [resume, setResume] = useState<ResumeState | null>(null);
  const [percentStore] = useState(() => createValueStore(0));
  /** Headings found in the rendered content (used when no `toc` prop is given). */
  const [domToc, setDomToc] = useState<TocEntry[]>([]);
  const onTapRef = useRef(opts.onHighlightTap);
  onTapRef.current = opts.onHighlightTap;

  // --------------------------------------------------------- scroll helpers
  const scroller = useCallback(() => scrollEl, [scrollEl]);
  const viewportTop = useCallback(() => scroller()?.getBoundingClientRect().top ?? 0, [scroller]);
  const viewportHeight = useCallback(() => scroller()?.clientHeight ?? window.innerHeight, [scroller]);
  const scrollTop = useCallback(() => scroller()?.scrollTop ?? window.scrollY, [scroller]);
  const scrollToY = useCallback(
    (y: number, smooth = true) => {
      const opts: ScrollToOptions = { top: Math.max(0, y), behavior: smooth && !prefersReducedMotion() ? "smooth" : "auto" };
      const el = scroller();
      if (el) el.scrollTo(opts);
      else window.scrollTo(opts);
    },
    [scroller],
  );
  /** Convert a viewport-relative `top` into a scroll position that puts it under the header. */
  const targetFor = useCallback(
    (rectTop: number, extra = 8) => scrollTop() + rectTop - viewportTop() - topOffset - extra,
    [scrollTop, viewportTop, topOffset],
  );

  // ------------------------------------------------------------ text index
  useEffect(() => {
    const root = rootEl;
    if (!root) return;
    const rebuild = () => {
      // Content rendered without the rehype plugin gets the same ids here.
      ensureBlockIds(root);
      setDomToc((prev) => {
        const next = collectToc(root);
        return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
      });
      indexRef.current = buildTextIndex(root);
      setVersion((v) => v + 1);
    };
    rebuild();
    let t: ReturnType<typeof setTimeout> | undefined;
    const mo = new MutationObserver(() => {
      clearTimeout(t);
      t = setTimeout(rebuild, 60);
    });
    // Attribute changes (our own ids) are deliberately not observed.
    mo.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      mo.disconnect();
      clearTimeout(t);
    };
  }, [rootEl, chapterId]);

  const getIndex = useCallback(() => {
    const root = rootRef.current;
    if (root && (!indexRef.current || indexRef.current.root !== root)) indexRef.current = buildTextIndex(root);
    return indexRef.current;
  }, []);

  // -------------------------------------------------------------- resolve
  const { resolved, orphaned } = useMemo(() => {
    const index = indexRef.current;
    const ok: ResolvedHighlight[] = [];
    const lost: Highlight[] = [];
    if (index) {
      for (const h of highlights) {
        const span = resolveAnchor(index, h.anchor);
        const range = span ? spanToRange(index, span) : null;
        if (span && range) ok.push({ highlight: h, span, range });
        else lost.push(h);
      }
    }
    return { resolved: ok, orphaned: lost };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlights, version]);
  const resolvedRef = useRef(resolved);
  resolvedRef.current = resolved;

  // Self-heal anchors that moved because the chapter was edited.
  useEffect(() => {
    const index = indexRef.current;
    if (!index) return;
    for (const r of resolved) {
      const a = r.highlight.anchor;
      if (a.start === r.span.start && a.end === r.span.end) continue;
      const fresh = describeSpan(index, r.span, contentHash);
      if (fresh) store.updateHighlight(bookId, r.highlight.id, { anchor: fresh });
    }
  }, [resolved, bookId, contentHash, store]);

  // ---------------------------------------------------------------- paint
  useEffect(() => paintHighlights(resolved, { activeId }), [resolved, activeId]);

  // ------------------------------------------------------------ selection
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      const index = getIndex();
      const sel = document.getSelection();
      const span = index ? selectionSpan(index, sel) : null;
      if (!index || !span || !sel || sel.rangeCount === 0) {
        setSelection(null);
        return;
      }
      const r = sel.getRangeAt(0).getBoundingClientRect();
      setSelection({
        span,
        text: spanToText(index, span),
        rect: { top: r.top, left: r.left, bottom: r.bottom, right: r.right, width: r.width, height: r.height },
      });
    };
    const onChange = () => {
      clearTimeout(t);
      t = setTimeout(update, 120);
    };
    document.addEventListener("selectionchange", onChange);
    return () => {
      document.removeEventListener("selectionchange", onChange);
      clearTimeout(t);
    };
  }, [getIndex]);

  const clearSelection = useCallback(() => {
    document.getSelection()?.removeAllRanges();
    setSelection(null);
  }, []);

  const selectSpan = useCallback(
    (span: TextSpan) => {
      const index = getIndex();
      const range = index && spanToRange(index, span);
      const sel = document.getSelection();
      if (!range || !sel) return;
      sel.removeAllRanges();
      sel.addRange(range);
    },
    [getIndex],
  );

  const expandSelectionToSentences = useCallback(
    (span?: TextSpan) => {
      const index = getIndex();
      const base = span ?? selection?.span;
      if (!index || !base) return;
      selectSpan(expandSpanToSentences(index, base, document.documentElement.lang || undefined));
    },
    [getIndex, selection, selectSpan],
  );

  const createHighlight = useCallback(
    (span: TextSpan, color?: string, note?: string): Highlight | null => {
      const index = getIndex();
      if (!index) return null;
      const anchor = describeSpan(index, span, contentHash);
      if (!anchor) return null;
      const dup = highlights.find((h) => h.anchor.start === anchor.start && h.anchor.end === anchor.end);
      if (dup) {
        if (color && dup.color !== color) store.updateHighlight(bookId, dup.id, { color });
        return dup;
      }
      return store.addHighlight({ bookId, chapterId, anchor, color, note, text: spanToText(index, span) });
    },
    [getIndex, contentHash, highlights, store, bookId, chapterId],
  );

  // ------------------------------------------------------------- tapping
  const highlightModeRef = useRef(settings.highlightMode);
  highlightModeRef.current = settings.highlightMode;
  const createRef = useRef(createHighlight);
  createRef.current = createHighlight;

  useEffect(() => {
    const root = rootEl;
    if (!root) return;
    const onClick = (e: MouseEvent) => {
      const sel = document.getSelection();
      if (sel && !sel.isCollapsed) return;
      if ((e.target as Element).closest?.(INTERACTIVE)) return;
      const index = getIndex();
      if (!index) return;
      const offset = offsetFromPoint(index, e.clientX, e.clientY);
      if (offset == null) return;
      const hit = highlightAtOffset(resolvedRef.current, offset);
      if (hit) {
        setActiveId(hit.highlight.id);
        onTapRef.current?.(hit.highlight.id);
        return;
      }
      if (highlightModeRef.current) {
        const span = sentenceSpanAt(index, offset, document.documentElement.lang || undefined);
        if (span && createRef.current(span)) navigator.vibrate?.(8);
      }
    };
    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }, [rootEl, getIndex]);

  // ----------------------------------------------------------- navigation
  const scrollToSpan = useCallback(
    (span: TextSpan, smooth = true) => {
      const index = getIndex();
      const range = index && spanToRange(index, span);
      if (!range) return false;
      scrollToY(targetFor(range.getBoundingClientRect().top, viewportHeight() * 0.15), smooth);
      return true;
    },
    [getIndex, scrollToY, targetFor, viewportHeight],
  );

  const scrollToHighlight = useCallback(
    (id: string, smooth = true) => {
      const r = resolvedRef.current.find((x) => x.highlight.id === id);
      if (!r) return false;
      setActiveId(id);
      return scrollToSpan(r.span, smooth);
    },
    [scrollToSpan],
  );

  const scrollToElement = useCallback(
    (el: Element | null, smooth = true) => {
      if (!el) return false;
      scrollToY(targetFor(el.getBoundingClientRect().top), smooth);
      return true;
    },
    [scrollToY, targetFor],
  );

  const scrollToBlock = useCallback(
    (blockId: string, smooth = true) => {
      const root = rootRef.current;
      return scrollToElement(root && findBlock(root, blockId), smooth);
    },
    [scrollToElement],
  );

  const scrollToHeading = useCallback(
    (id: string, smooth = true) => scrollToElement(rootRef.current?.ownerDocument.getElementById(id) ?? null, smooth),
    [scrollToElement],
  );

  const scrollToTop = useCallback(() => scrollToY(0), [scrollToY]);

  /** Block at the top of the reading viewport. */
  const getTopBlock = useCallback((): Element | null => {
    const root = rootRef.current;
    if (!root) return null;
    const line = viewportTop() + topOffset + 8;
    for (const el of Array.from(root.querySelectorAll(`[${BLOCK_ATTR}]`))) {
      if (el.getBoundingClientRect().bottom > line) return el;
    }
    return null;
  }, [viewportTop, topOffset]);

  // -------------------------------------------------------------- progress
  useEffect(() => {
    const root = rootEl;
    if (!root) return;
    const target: HTMLElement | Window = scroller() ?? window;
    let raf = 0;
    let lastSave = 0;
    let pending: ReturnType<typeof setTimeout> | undefined;
    const compute = () => {
      const box = root.getBoundingClientRect();
      const top = box.top - viewportTop();
      const total = box.height - viewportHeight() + topOffset;
      const percent = total <= 0 ? 1 : Math.max(0, Math.min(1, (topOffset - top) / total));
      percentStore.set(percent);
      return percent;
    };
    const save = () => {
      const percent = compute();
      const block = getTopBlock();
      store.recordProgress(bookId, chapterId, { blockId: block?.getAttribute(BLOCK_ATTR) ?? undefined, percent });
      lastSave = Date.now();
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        compute();
        clearTimeout(pending);
        pending = setTimeout(save, Math.max(0, options.progress.saveIntervalMs - (Date.now() - lastSave)));
      });
    };
    compute();
    target.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    window.addEventListener("pagehide", save);
    return () => {
      target.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("pagehide", save);
      cancelAnimationFrame(raf);
      clearTimeout(pending);
    };
  }, [rootEl, scroller, viewportTop, viewportHeight, bookId, chapterId, store, options.progress.saveIntervalMs, getTopBlock, topOffset, percentStore]);

  // ---------------------------------------------------------------- resume
  // Restoration is async (fonts) and the root may remount in between (layout
  // switch after hydration), so `run` always reads the latest callbacks.
  const latest = useRef({ scrollToHighlight, scrollToBlock, scrollToHeading, scrollTop });
  latest.current = { scrollToHighlight, scrollToBlock, scrollToHeading, scrollTop };
  const restoredFor = useRef<string | null>(null);
  useEffect(() => {
    if (!rootEl || version === 0 || restoredFor.current === chapterId) return;
    restoredFor.current = chapterId;
    const hash = decodeURIComponent(window.location.hash.slice(1));
    const run = () => {
      const l = latest.current;
      if (hash.startsWith("hl-")) {
        if (l.scrollToHighlight(hash.slice(3), false)) return;
      } else if (hash.startsWith("b-")) {
        if (l.scrollToBlock(hash.slice(2), false)) return;
      } else if (hash) {
        l.scrollToHeading(hash, false);
        return;
      }
      const saved = store.progress(bookId).get().chapters[chapterId];
      if (saved?.blockId && saved.percent > 0.03 && saved.percent < 0.98 && l.scrollTop() < 40) {
        if (l.scrollToBlock(saved.blockId, false)) setResume({ blockId: saved.blockId, percent: saved.percent });
      }
    };
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    const go = () => requestAnimationFrame(() => requestAnimationFrame(run));
    if (fonts?.ready) void fonts.ready.then(go);
    else go();
  }, [version, chapterId, bookId, store, rootEl]);

  const dismissResume = useCallback(() => setResume(null), []);

  return {
    highlights,
    resolved,
    orphaned,
    selection,
    activeId,
    setActiveId,
    resume,
    dismissResume,
    percentStore,
    domToc,
    clearSelection,
    selectSpan,
    expandSelectionToSentences,
    createHighlight,
    scrollToHighlight,
    scrollToBlock,
    scrollToHeading,
    scrollToTop,
    getTopBlock,
    getIndex,
  };
}

export type ChapterEngine = ReturnType<typeof useChapterEngine>;
