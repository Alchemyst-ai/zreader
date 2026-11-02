import {
  isBookmark,
  isHighlight,
  isObj,
  sanitizeList,
  sanitizePad,
  sanitizeProgress,
  sanitizeSettings,
  unwrap,
  wrap,
  type Envelope,
  type RecordType,
} from "./schema";
import type { ReaderStore } from "./store";
import type { Bookmark, BookProgress, Highlight, Pad, ReaderSettings } from "./types";

export const BACKUP_FORMAT = "zreader-backup";
/** Backups written before the rename to zreader; still accepted on import. */
export const LEGACY_BACKUP_FORMATS: readonly string[] = ["alr-backup"];
export const BACKUP_VERSION = 1;

export interface Backup {
  format: typeof BACKUP_FORMAT | "alr-backup";
  schemaVersion: number;
  exportedAt: string;
  /** Keys are store-relative (prefix stripped), values are stored envelopes. */
  records: Record<string, Envelope>;
}

export function recordTypeForKey(key: string): RecordType | null {
  if (key === "settings") return "settings";
  if (key.startsWith("pad:")) return "pad";
  const m = /^book:[^:]+:(highlights|bookmarks|progress)$/.exec(key);
  return (m?.[1] as RecordType | undefined) ?? null;
}

function bookIdFromKey(key: string): string {
  return decodeURIComponent(key.split(":")[1] ?? "");
}

export function exportBackup(store: ReaderStore, opts: { bookId?: string } = {}): Backup {
  store.flush();
  const records: Record<string, Envelope> = {};
  for (const fullKey of store.keys()) {
    const key = fullKey.slice(store.prefix.length);
    if (!recordTypeForKey(key)) continue;
    if (opts.bookId) {
      const enc = encodeURIComponent(opts.bookId);
      if (!key.startsWith(`book:${enc}:`) && !key.startsWith(`pad:book:${enc}`) && !key.startsWith(`pad:chapter:${enc}:`))
        continue;
    }
    try {
      const env = JSON.parse(store.adapter.get(fullKey) ?? "null");
      if (isObj(env) && typeof env.v === "number") records[key] = env as unknown as Envelope;
    } catch {
      /* skip corrupt */
    }
  }
  return { format: BACKUP_FORMAT, schemaVersion: BACKUP_VERSION, exportedAt: new Date().toISOString(), records };
}

export class BackupFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupFormatError";
  }
}

export function parseBackup(input: string | unknown): Backup {
  let data: unknown = input;
  if (typeof input === "string") {
    try {
      data = JSON.parse(input);
    } catch {
      throw new BackupFormatError("Backup is not valid JSON");
    }
  }
  if (!isObj(data) || (data.format !== BACKUP_FORMAT && !LEGACY_BACKUP_FORMATS.includes(String(data.format))))
    throw new BackupFormatError("Not a zreader backup");
  if (typeof data.schemaVersion !== "number" || data.schemaVersion > BACKUP_VERSION)
    throw new BackupFormatError("Backup was created by a newer version of the reader");
  if (!isObj(data.records)) throw new BackupFormatError("Backup has no records");
  return data as unknown as Backup;
}

function newer<T extends { updatedAt: string }>(a: T, b: T): T {
  return a.updatedAt >= b.updatedAt ? a : b;
}

function mergeById<T extends { id: string; updatedAt: string }>(local: T[], incoming: T[]): T[] {
  const map = new Map(local.map((x) => [x.id, x]));
  for (const x of incoming) {
    const cur = map.get(x.id);
    map.set(x.id, cur ? newer(cur, x) : x);
  }
  return [...map.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
}

function mergeProgress(local: BookProgress, incoming: BookProgress): BookProgress {
  const chapters = { ...local.chapters };
  for (const [k, v] of Object.entries(incoming.chapters)) {
    const cur = chapters[k];
    chapters[k] = cur ? newer(cur, v) : v;
  }
  const last = local.last && incoming.last ? newer(local.last, incoming.last) : (local.last ?? incoming.last);
  return { bookId: local.bookId, chapters, ...(last ? { last } : {}) };
}

export interface ImportResult {
  imported: number;
  skipped: number;
}

/**
 * Import a backup. `merge` (default) unions lists by id and keeps the most recently
 * updated version of every record; `replace` wipes this store's keys first.
 */
export function importBackup(
  store: ReaderStore,
  input: string | Backup,
  opts: { mode?: "merge" | "replace" } = {},
): ImportResult {
  const backup = parseBackup(input);
  const mode = opts.mode ?? "merge";
  store.flush();
  if (mode === "replace") for (const k of store.keys()) store.adapter.remove(k);

  let imported = 0;
  let skipped = 0;
  const defaults = sanitizeSettings(undefined, store.settings().get());

  for (const [key, env] of Object.entries(backup.records)) {
    const type = recordTypeForKey(key);
    if (!type) {
      skipped++;
      continue;
    }
    const data = unwrap(type, JSON.stringify(env));
    if (data === undefined) {
      skipped++;
      continue;
    }
    const fullKey = store.prefix + key;
    const localRaw = mode === "merge" ? unwrap(type, store.adapter.get(fullKey)) : undefined;
    let out: unknown;
    switch (type) {
      case "highlights":
        out = mergeById<Highlight>(sanitizeList(localRaw, isHighlight), sanitizeList(data, isHighlight));
        break;
      case "bookmarks":
        out = mergeById<Bookmark>(sanitizeList(localRaw, isBookmark), sanitizeList(data, isBookmark));
        break;
      case "progress": {
        const id = bookIdFromKey(key);
        out = mergeProgress(sanitizeProgress(localRaw, id), sanitizeProgress(data, id));
        break;
      }
      case "pad": {
        const inc = sanitizePad(data);
        const loc = sanitizePad(localRaw);
        if (!inc) {
          skipped++;
          continue;
        }
        out = loc ? newer<Pad>(loc, inc) : inc;
        break;
      }
      case "settings": {
        const inc = sanitizeSettings(data, defaults);
        out = localRaw === undefined ? inc : newer<ReaderSettings>(sanitizeSettings(localRaw, defaults), inc);
        break;
      }
    }
    try {
      store.adapter.set(fullKey, wrap(type, out));
      imported++;
    } catch {
      skipped++;
    }
  }
  store.reloadAll();
  return { imported, skipped };
}

/** Human-readable export of a book's highlights and notes. */
export function highlightsToMarkdown(
  title: string,
  highlights: Highlight[],
  chapterTitle: (chapterId: string) => string = (c) => c,
): string {
  const byChapter = new Map<string, Highlight[]>();
  for (const h of highlights) {
    const list = byChapter.get(h.chapterId) ?? [];
    list.push(h);
    byChapter.set(h.chapterId, list);
  }
  const out = [`# ${title} — highlights`, ""];
  for (const [chapterId, list] of byChapter) {
    out.push(`## ${chapterTitle(chapterId)}`, "");
    for (const h of [...list].sort((a, b) => a.anchor.start - b.anchor.start)) {
      out.push(...h.anchor.exact.trim().split(/\r?\n/).map((l) => `> ${l}`));
      if (h.note) out.push("", h.note);
      out.push("");
    }
  }
  return out.join("\n");
}
