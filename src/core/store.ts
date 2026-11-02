import { createLocalStorageAdapter, StorageQuotaError, type StorageAdapter } from "./storage";
import {
  isBookmark,
  isHighlight,
  sanitizeList,
  sanitizePad,
  sanitizeProgress,
  sanitizeSettings,
  unwrap,
  wrap,
  type RecordType,
} from "./schema";
import type {
  Anchor,
  Bookmark,
  BookProgress,
  Highlight,
  Pad,
  PadScope,
  ReaderClientOptions,
  ReaderSettings,
} from "./types";
import { DEFAULT_CLIENT_OPTIONS } from "./defaults";

export interface Cell<T> {
  /** Stable reference until the value changes (safe for useSyncExternalStore). */
  get(): T;
  set(next: T | ((prev: T) => T)): void;
  subscribe(listener: () => void): () => void;
}

export interface ReaderStoreOptions {
  adapter?: StorageAdapter;
  options?: Partial<ReaderClientOptions>;
  /** Debounce for writes (ms). Writes are also flushed on `pagehide`. */
  writeDelay?: number;
  onError?: (error: unknown) => void;
  now?: () => Date;
  id?: () => string;
}

export type ReaderStore = ReturnType<typeof createReaderStore>;

const enc = encodeURIComponent;

export function padKeySuffix(scope: PadScope): string {
  switch (scope.kind) {
    case "global":
      return "pad:global";
    case "book":
      return `pad:book:${enc(scope.bookId)}`;
    case "chapter":
      return `pad:chapter:${enc(scope.bookId)}:${enc(scope.chapterId)}`;
  }
}

export function defaultId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createReaderStore(opts: ReaderStoreOptions = {}) {
  const adapter = opts.adapter ?? createLocalStorageAdapter();
  const options: ReaderClientOptions = { ...DEFAULT_CLIENT_OPTIONS, ...opts.options };
  const prefix = `${options.storagePrefix}:v1:`;
  const writeDelay = opts.writeDelay ?? 200;
  const onError = opts.onError ?? ((e) => console.warn("[zreader]", e));
  const now = () => (opts.now ? opts.now() : new Date()).toISOString();
  const newId = opts.id ?? defaultId;

  const defaultSettings: ReaderSettings = { ...options.defaultSettings, updatedAt: new Date(0).toISOString() };

  type AnyCell = Cell<unknown> & { reload(): void; flush(): void; key: string };
  const cells = new Map<string, AnyCell>();

  function cell<T>(suffix: string, type: RecordType, parse: (raw: unknown) => T): Cell<T> {
    const key = prefix + suffix;
    const existing = cells.get(key);
    if (existing) return existing as unknown as Cell<T>;

    let value = parse(unwrap(type, adapter.get(key)));
    let timer: ReturnType<typeof setTimeout> | undefined;
    let dirty = false;
    const listeners = new Set<() => void>();
    const emit = () => listeners.forEach((l) => l());

    const flush = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      if (!dirty) return;
      dirty = false;
      try {
        adapter.set(key, wrap(type, value));
      } catch (err) {
        onError(err instanceof StorageQuotaError ? err : new StorageQuotaError(key, err));
      }
    };

    const c: AnyCell = {
      key,
      get: () => value as unknown,
      set: (next) => {
        const v = typeof next === "function" ? (next as (p: unknown) => unknown)(value) : next;
        if (Object.is(v, value)) return;
        value = v as T;
        dirty = true;
        emit();
        if (writeDelay <= 0) flush();
        else {
          if (timer) clearTimeout(timer);
          timer = setTimeout(flush, writeDelay);
        }
      },
      subscribe: (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      reload: () => {
        if (dirty) return; // a local write is pending; it wins
        value = parse(unwrap(type, adapter.get(key)));
        emit();
      },
      flush,
    };
    cells.set(key, c);
    return c as unknown as Cell<T>;
  }

  const flushAll = () => cells.forEach((c) => c.flush());
  let connections = 0;
  let disconnect: (() => void) | undefined;

  /**
   * Start cross-tab sync and flush-on-hide. Ref-counted, so it is safe to call
   * from effects that may run twice (React StrictMode). Returns a disposer.
   */
  function connect(): () => void {
    if (connections++ === 0) {
      const unsubscribeAdapter = adapter.subscribe((key) => {
        if (key == null) cells.forEach((c) => c.reload());
        else cells.get(key)?.reload();
      });
      const onHide = () => flushAll();
      const onVisibility = () => {
        if (document.visibilityState === "hidden") flushAll();
      };
      if (typeof window !== "undefined") {
        window.addEventListener("pagehide", onHide);
        document.addEventListener("visibilitychange", onVisibility);
      }
      disconnect = () => {
        flushAll();
        unsubscribeAdapter();
        if (typeof window !== "undefined") {
          window.removeEventListener("pagehide", onHide);
          document.removeEventListener("visibilitychange", onVisibility);
        }
      };
    }
    let done = false;
    return () => {
      if (done) return;
      done = true;
      if (--connections === 0) disconnect?.();
    };
  }

  // ------------------------------------------------------------------ cells
  const settings = () => cell<ReaderSettings>("settings", "settings", (x) => sanitizeSettings(x, defaultSettings));
  const highlights = (bookId: string) =>
    cell<Highlight[]>(`book:${enc(bookId)}:highlights`, "highlights", (x) => sanitizeList(x, isHighlight));
  const bookmarks = (bookId: string) =>
    cell<Bookmark[]>(`book:${enc(bookId)}:bookmarks`, "bookmarks", (x) => sanitizeList(x, isBookmark));
  const progress = (bookId: string) =>
    cell<BookProgress>(`book:${enc(bookId)}:progress`, "progress", (x) => sanitizeProgress(x, bookId));
  const emptyPad: Pad = { markdown: "", updatedAt: new Date(0).toISOString() };
  const pad = (scope: PadScope) => cell<Pad>(padKeySuffix(scope), "pad", (x) => sanitizePad(x) ?? emptyPad);

  /** Stable values used as the server snapshot during SSR/hydration. */
  const emptyList: never[] = [];
  const emptyProgress = new Map<string, BookProgress>();
  const server = {
    settings: defaultSettings,
    list: emptyList,
    pad: emptyPad,
    progress(bookId: string): BookProgress {
      let p = emptyProgress.get(bookId);
      if (!p) emptyProgress.set(bookId, (p = { bookId, chapters: {} }));
      return p;
    },
  };

  // ------------------------------------------------------------- operations
  const api = {
    options,
    adapter,
    server,
    prefix,
    settings,
    highlights,
    bookmarks,
    progress,
    pad,

    updateSettings(patch: Partial<Omit<ReaderSettings, "updatedAt">>) {
      settings().set((s) => ({ ...s, ...patch, updatedAt: now() }));
    },
    resetSettings() {
      settings().set({ ...defaultSettings, updatedAt: now() });
    },

    addHighlight(input: { bookId: string; chapterId: string; anchor: Anchor; color?: string; note?: string }): Highlight {
      const t = now();
      const h: Highlight = {
        id: newId(),
        bookId: input.bookId,
        chapterId: input.chapterId,
        anchor: input.anchor,
        color: input.color ?? options.defaultHighlightColor,
        ...(input.note ? { note: input.note } : {}),
        createdAt: t,
        updatedAt: t,
      };
      highlights(input.bookId).set((list) => [...list, h]);
      return h;
    },
    updateHighlight(bookId: string, id: string, patch: Partial<Pick<Highlight, "color" | "note" | "anchor">>) {
      highlights(bookId).set((list) =>
        list.map((h) => {
          if (h.id !== id) return h;
          const next: Highlight = { ...h, ...patch, updatedAt: now() };
          if (patch.note !== undefined && !patch.note.trim()) delete next.note;
          return next;
        }),
      );
    },
    removeHighlight(bookId: string, id: string) {
      highlights(bookId).set((list) => list.filter((h) => h.id !== id));
    },

    addBookmark(input: Omit<Bookmark, "id" | "createdAt" | "updatedAt">): Bookmark {
      const t = now();
      const b: Bookmark = { ...input, id: newId(), createdAt: t, updatedAt: t };
      bookmarks(input.bookId).set((list) => [...list, b]);
      return b;
    },
    removeBookmark(bookId: string, id: string) {
      bookmarks(bookId).set((list) => list.filter((b) => b.id !== id));
    },
    findChapterBookmark(bookId: string, chapterId: string): Bookmark | undefined {
      return bookmarks(bookId)
        .get()
        .find((b) => b.chapterId === chapterId && !b.blockId);
    },
    /** Toggle a whole-chapter bookmark. Returns whether the chapter is now bookmarked. */
    toggleChapterBookmark(bookId: string, chapterId: string, label?: string): boolean {
      const existing = api.findChapterBookmark(bookId, chapterId);
      if (existing) {
        api.removeBookmark(bookId, existing.id);
        return false;
      }
      api.addBookmark({ bookId, chapterId, ...(label ? { label } : {}) });
      return true;
    },

    recordProgress(bookId: string, chapterId: string, p: { blockId?: string; percent: number }) {
      const t = now();
      const percent = Math.max(0, Math.min(1, p.percent));
      progress(bookId).set((prev) => {
        const old = prev.chapters[chapterId];
        const completed = (old?.completed ?? false) || percent >= options.progress.completeAt;
        if (old && old.blockId === p.blockId && Math.abs(old.percent - percent) < 0.005 && old.completed === completed) {
          return prev;
        }
        return {
          ...prev,
          chapters: {
            ...prev.chapters,
            [chapterId]: { chapterId, blockId: p.blockId, percent, completed, updatedAt: t },
          },
          last: { chapterId, blockId: p.blockId, updatedAt: t },
        };
      });
    },
    markChapterComplete(bookId: string, chapterId: string, completed = true) {
      const t = now();
      progress(bookId).set((prev) => {
        const old = prev.chapters[chapterId];
        return {
          ...prev,
          chapters: {
            ...prev.chapters,
            [chapterId]: {
              chapterId,
              blockId: old?.blockId,
              percent: completed ? 1 : (old?.percent ?? 0),
              completed,
              updatedAt: t,
            },
          },
        };
      });
    },

    savePad(scope: PadScope, markdown: string, json?: unknown) {
      pad(scope).set({ markdown, ...(json !== undefined ? { json } : {}), updatedAt: now() });
    },
    /** Append markdown to a pad from outside the editor (drops the JSON cache so the editor re-parses). */
    appendToPad(scope: PadScope, markdown: string) {
      pad(scope).set((p) => ({
        markdown: p.markdown.trim() ? `${p.markdown.replace(/\s+$/, "")}\n\n${markdown}\n` : `${markdown}\n`,
        updatedAt: now(),
      }));
    },
    clearPad(scope: PadScope) {
      adapter.remove(prefix + padKeySuffix(scope));
      cells.get(prefix + padKeySuffix(scope))?.reload();
    },

    /** All storage keys owned by this store's prefix. */
    keys(): string[] {
      return adapter.keys(prefix);
    },
    flush: flushAll,
    connect,
    /** Drop cached cells so the next read comes from storage (used after imports). */
    reloadAll() {
      cells.forEach((c) => {
        c.flush();
        c.reload();
      });
    },
  };
  return api;
}

/** Markdown blockquote for a passage, optionally linking back to its source. */
export function quoteToMarkdown(text: string, opts: { href?: string; note?: string } = {}): string {
  const quote = text
    .trim()
    .split(/\r?\n/)
    .map((l) => `> ${l}`)
    .join("\n");
  const link = opts.href ? `\n>\n> — [source](${opts.href})` : "";
  const note = opts.note ? `\n\n${opts.note}` : "";
  return `${quote}${link}${note}`;
}

/** Markdown snippet used when sending a highlight to the scratchpad. */
export function highlightToMarkdown(h: Pick<Highlight, "anchor" | "note">, href?: string): string {
  return quoteToMarkdown(h.anchor.exact, { href, note: h.note });
}
