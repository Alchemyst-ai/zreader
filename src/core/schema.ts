import {
  FONT_FAMILIES,
  LEADINGS,
  MEASURES,
  TEXT_SIZES,
  type Anchor,
  type Bookmark,
  type BookProgress,
  type ChapterProgress,
  type Highlight,
  type Pad,
  type ReaderSettings,
} from "./types";

/**
 * Every persisted value is wrapped in an envelope carrying its schema version so
 * records written by older versions of the package can be migrated forward.
 */
export interface Envelope<T = unknown> {
  v: number;
  data: T;
}

export type RecordType = "settings" | "highlights" | "bookmarks" | "progress" | "pad";

type Migration = (data: unknown) => unknown;

/**
 * `MIGRATIONS[type][i]` upgrades data from version `i + 1` to `i + 2`.
 * Add a function here (never edit an old one) whenever a record shape changes.
 */
export const MIGRATIONS: Record<RecordType, Migration[]> = {
  settings: [],
  highlights: [],
  bookmarks: [],
  progress: [],
  pad: [],
};

export function currentVersion(type: RecordType, migrations = MIGRATIONS): number {
  return migrations[type].length + 1;
}

export function wrap<T>(type: RecordType, data: T, migrations = MIGRATIONS): string {
  return JSON.stringify({ v: currentVersion(type, migrations), data } satisfies Envelope<T>);
}

/** Parse + migrate. Returns `undefined` for missing, corrupt, or future-version data. */
export function unwrap(type: RecordType, raw: string | null, migrations = MIGRATIONS): unknown {
  if (raw == null) return undefined;
  let env: unknown;
  try {
    env = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isObj(env) || typeof env.v !== "number" || !("data" in env)) return undefined;
  const target = currentVersion(type, migrations);
  if (env.v > target) return undefined; // written by a newer version; don't clobber-interpret
  let data = env.data;
  for (let v = env.v; v < target; v++) {
    const m = migrations[type][v - 1];
    if (!m) return undefined;
    data = m(data);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Validators: tiny hand-written guards (no runtime dependency in core).
// Invalid list items are dropped individually instead of discarding everything.
// ---------------------------------------------------------------------------

export function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
const str = (x: unknown): x is string => typeof x === "string";
const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const optStr = (x: unknown) => x === undefined || str(x);

export function isAnchor(x: unknown): x is Anchor {
  return (
    isObj(x) &&
    str(x.blockId) &&
    num(x.blockStart) &&
    num(x.start) &&
    num(x.end) &&
    x.end >= x.start &&
    str(x.exact) &&
    str(x.prefix) &&
    str(x.suffix) &&
    optStr(x.contentHash)
  );
}

export function isHighlight(x: unknown): x is Highlight {
  return (
    isObj(x) &&
    str(x.id) &&
    str(x.bookId) &&
    str(x.chapterId) &&
    isAnchor(x.anchor) &&
    str(x.color) &&
    optStr(x.note) &&
    str(x.createdAt) &&
    str(x.updatedAt)
  );
}

export function isBookmark(x: unknown): x is Bookmark {
  return (
    isObj(x) &&
    str(x.id) &&
    str(x.bookId) &&
    str(x.chapterId) &&
    optStr(x.blockId) &&
    optStr(x.label) &&
    optStr(x.excerpt) &&
    str(x.createdAt) &&
    str(x.updatedAt)
  );
}

function isChapterProgress(x: unknown): x is ChapterProgress {
  return (
    isObj(x) &&
    str(x.chapterId) &&
    optStr(x.blockId) &&
    num(x.percent) &&
    typeof x.completed === "boolean" &&
    str(x.updatedAt)
  );
}

export function sanitizeProgress(x: unknown, bookId: string): BookProgress {
  const out: BookProgress = { bookId, chapters: {} };
  if (!isObj(x)) return out;
  if (isObj(x.chapters)) {
    for (const [k, v] of Object.entries(x.chapters)) if (isChapterProgress(v)) out.chapters[k] = v;
  }
  if (isObj(x.last) && str(x.last.chapterId) && str(x.last.updatedAt) && optStr(x.last.blockId)) {
    out.last = { chapterId: x.last.chapterId, blockId: x.last.blockId as string | undefined, updatedAt: x.last.updatedAt };
  }
  return out;
}

export function sanitizeList<T>(x: unknown, guard: (i: unknown) => i is T): T[] {
  return Array.isArray(x) ? x.filter(guard) : [];
}

export function sanitizePad(x: unknown): Pad | undefined {
  if (!isObj(x) || !str(x.markdown) || !str(x.updatedAt)) return undefined;
  return { markdown: x.markdown, json: x.json, updatedAt: x.updatedAt };
}

const oneOf =
  (list: readonly string[]) =>
  (v: unknown): boolean =>
    typeof v === "string" && list.includes(v);

export function sanitizeSettings(x: unknown, defaults: ReaderSettings): ReaderSettings {
  if (!isObj(x)) return defaults;
  const pick = <K extends keyof ReaderSettings>(k: K, ok: (v: unknown) => boolean): ReaderSettings[K] =>
    (ok(x[k]) ? x[k] : defaults[k]) as ReaderSettings[K];
  return {
    textSize: pick("textSize", oneOf(TEXT_SIZES)),
    leading: pick("leading", oneOf(LEADINGS)),
    measure: pick("measure", oneOf(MEASURES)),
    fontFamily: pick("fontFamily", oneOf(FONT_FAMILIES)),
    highlightMode: pick("highlightMode", (v) => typeof v === "boolean"),
    updatedAt: pick("updatedAt", str),
  };
}
