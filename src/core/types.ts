import type { DangerousPermissions } from "./sandbox";
/** Shared, framework-agnostic data model for zreader. */

export type ISODate = string;

/** W3C Web Annotation-style anchor. Offsets are measured over the chapter root's text. */
export interface Anchor {
  /** `data-block-id` of the block containing the start of the selection. */
  blockId: string;
  /** Offsets relative to the start block's text (fast path). */
  blockStart: number;
  /** TextPositionSelector over the whole chapter text. */
  start: number;
  end: number;
  /** TextQuoteSelector. */
  exact: string;
  prefix: string;
  suffix: string;
  /** Content hash of the chapter when the anchor was created. */
  contentHash?: string;
}

export interface Highlight {
  id: string;
  bookId: string;
  chapterId: string;
  anchor: Anchor;
  color: string;
  note?: string;
  /**
   * The passage as Markdown when it differs from `anchor.exact`: formulas as
   * `$TeX$` (`anchor.exact` holds the rendered characters, which anchoring needs).
   */
  text?: string;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface Bookmark {
  id: string;
  bookId: string;
  chapterId: string;
  /** Absent for whole-chapter bookmarks. */
  blockId?: string;
  label?: string;
  excerpt?: string;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface ChapterProgress {
  chapterId: string;
  blockId?: string;
  /** 0..1 */
  percent: number;
  completed: boolean;
  updatedAt: ISODate;
}

export interface BookProgress {
  bookId: string;
  chapters: Record<string, ChapterProgress>;
  last?: { chapterId: string; blockId?: string; updatedAt: ISODate };
}

export type PadScope =
  | { kind: "global" }
  | { kind: "book"; bookId: string }
  | { kind: "chapter"; bookId: string; chapterId: string };

export type PadScopeKind = PadScope["kind"];

export interface Pad {
  /** Markdown is the interchange/source format. */
  markdown: string;
  /** Lossless editor JSON cache. Cleared whenever `markdown` is changed outside the editor. */
  json?: unknown;
  updatedAt: ISODate;
}

export type ThemeName = "system" | "light" | "sepia" | "dark";
export type Measure = "narrow" | "normal" | "wide";
export type FontFamily = "serif" | "sans" | "mono";
export type TextSize = "sm" | "base" | "lg" | "xl" | "2xl";
export type Leading = "tight" | "normal" | "relaxed";

export const THEMES = ["system", "light", "sepia", "dark"] as const satisfies readonly ThemeName[];
export const TEXT_SIZES = ["sm", "base", "lg", "xl", "2xl"] as const satisfies readonly TextSize[];
export const LEADINGS = ["tight", "normal", "relaxed"] as const satisfies readonly Leading[];
export const MEASURES = ["narrow", "normal", "wide"] as const satisfies readonly Measure[];
export const FONT_FAMILIES = ["serif", "sans", "mono"] as const satisfies readonly FontFamily[];
/** The palette the UI ships styles for (`::highlight(zr-<color>)`). */
export const HIGHLIGHT_COLORS = ["yellow", "green", "blue", "pink", "purple", "orange"] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

export interface ReaderSettings {
  textSize: TextSize;
  leading: Leading;
  measure: Measure;
  fontFamily: FontFamily;
  /** Tap a sentence to highlight it with the default colour. */
  highlightMode: boolean;
  updatedAt: ISODate;
}

/**
 * Limits on RunnableCode. They can only narrow what the Sandbox the app
 * provides may do: without a Sandbox, RunnableCode is off whatever is set here.
 */
export interface SandboxOptions {
  /** Where RunnableCode in each kind of pad runs: `"browser"`, or `false` to show it as plain code. */
  scopes: Record<PadScopeKind, "browser" | false>;
  /** Where RunnableCode the author wrote in chapters runs: `"browser"`, or `false` to show it as plain code. */
  chapters: "browser" | false;
  kernel: {
    /** A Kernel with no run for this long is shut down. `0` or `false`: never. Default 15 minutes. */
    idleTimeoutMs: number | false;
    /** A run longer than this is stopped. `false`: no limit. Default 30 seconds. */
    runTimeoutMs: number | false;
  };
  /** Dangerous permissions, granted only here, per codeSource. All off by default. */
  permissions: { scratchpad: { dangerousPermissions: DangerousPermissions } };
}

/** Serializable client options (the `reader` half of reader.config.ts). */
export interface ReaderClientOptions {
  storagePrefix: string;
  highlightColors: HighlightColor[];
  defaultHighlightColor: HighlightColor;
  scratchpad: { enabled: boolean; scopes: PadScopeKind[] };
  /**
   * Images readers paste or drop into the scratchpad and notes, stored in
   * IndexedDB. `maxBytes` caps one image.
   */
  userImages: { enabled: boolean; maxBytes: number };
  /**
   * Offline reading (opt-in): a "Save for offline" button on book pages, backed
   * by the service worker from `zreader/sw`, served at `serviceWorker`.
   */
  offline: { enabled: boolean; serviceWorker: string };
  /** Themes offered in the UI. Applied as a class on <html> via next-themes. */
  themes: ThemeName[];
  defaultTheme: ThemeName;
  defaultSettings: Omit<ReaderSettings, "updatedAt">;
  progress: { completeAt: number; saveIntervalMs: number };
  /** Show a "your notes only live in this browser" reminder. */
  backupReminder: boolean;
  /** Base path used to build links back into the reader (e.g. quote-to-pad). */
  basePath: string;
  /** RunnableCode limits; see `SandboxOptions`. */
  sandbox: SandboxOptions;
}

export interface TocEntry {
  id: string;
  depth: number;
  text: string;
}

export interface ChapterMeta {
  id: string;
  title: string;
  order: number;
  description?: string;
  /** Section the chapter belongs to, e.g. "Part I · For the Builders". Groups the contents list. */
  part?: string;
  /** Eyebrow shown above the title, e.g. "Chapter 5" or "Appendix A". */
  label?: string;
  /** Short marker for lists, e.g. "5" or "A". */
  number?: string;
}

export interface BookMeta {
  id: string;
  title: string;
  subtitle?: string;
  authors: string[];
  description?: string;
  cover?: string;
  chapters: ChapterMeta[];
}
