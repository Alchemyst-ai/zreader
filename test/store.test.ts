import { describe, expect, it, vi } from "vitest";
import {
  createMemoryAdapter,
  createReaderStore,
  exportBackup,
  importBackup,
  StorageQuotaError,
  unwrap,
  wrap,
  BackupFormatError,
  type Anchor,
  type StorageAdapter,
} from "../src/core/index";
import { MIGRATIONS } from "../src/core/schema";

const anchor = (start: number, exact = "hello"): Anchor => ({
  blockId: "p-1",
  blockStart: start,
  start,
  end: start + exact.length,
  exact,
  prefix: "",
  suffix: "",
});

let seq = 0;
const mk = (adapter: StorageAdapter = createMemoryAdapter(), now = () => new Date("2026-01-01T00:00:00Z")) =>
  createReaderStore({ adapter, writeDelay: 0, now, id: () => `id-${++seq}` });

describe("store", () => {
  it("persists highlights, bookmarks, progress, pads and settings under versioned keys", () => {
    const adapter = createMemoryAdapter();
    const s = mk(adapter);
    s.addHighlight({ bookId: "b", chapterId: "c", anchor: anchor(0), color: "green" });
    s.addBookmark({ bookId: "b", chapterId: "c", blockId: "p-1" });
    s.recordProgress("b", "c", { blockId: "p-1", percent: 0.5 });
    s.savePad({ kind: "chapter", bookId: "b", chapterId: "c" }, "- [ ] todo");
    s.updateSettings({ textSize: "xl" });

    expect(adapter.keys().sort()).toEqual([
      "zr:v1:book:b:bookmarks",
      "zr:v1:book:b:highlights",
      "zr:v1:book:b:progress",
      "zr:v1:pad:chapter:b:c",
      "zr:v1:settings",
    ]);

    const again = mk(adapter);
    expect(again.highlights("b").get()).toHaveLength(1);
    expect(again.highlights("b").get()[0]!.color).toBe("green");
    expect(again.progress("b").get().last?.chapterId).toBe("c");
    expect(again.pad({ kind: "chapter", bookId: "b", chapterId: "c" }).get().markdown).toBe("- [ ] todo");
    expect(again.settings().get().textSize).toBe("xl");
  });

  it("returns stable snapshots and notifies subscribers", () => {
    const s = mk();
    const cell = s.highlights("b");
    const a = cell.get();
    expect(cell.get()).toBe(a);
    const fn = vi.fn();
    cell.subscribe(fn);
    s.addHighlight({ bookId: "b", chapterId: "c", anchor: anchor(0) });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(cell.get()).not.toBe(a);
  });

  it("drops invalid list items instead of discarding the collection", () => {
    const adapter = createMemoryAdapter({
      "zr:v1:book:b:highlights": JSON.stringify({ v: 1, data: [{ nope: true }, { id: "x", bookId: "b", chapterId: "c", anchor: anchor(1), color: "yellow", createdAt: "t", updatedAt: "t" }] }),
    });
    expect(mk(adapter).highlights("b").get().map((h) => h.id)).toEqual(["x"]);
  });

  it("ignores corrupt and future-version records", () => {
    expect(unwrap("settings", "{not json")).toBeUndefined();
    expect(unwrap("settings", JSON.stringify({ v: 99, data: {} }))).toBeUndefined();
  });

  it("runs migrations forward", () => {
    const migrations = { ...MIGRATIONS, pad: [(d: unknown) => ({ ...(d as object), migrated: true })] };
    const raw = JSON.stringify({ v: 1, data: { markdown: "x" } });
    expect(unwrap("pad", raw, migrations)).toEqual({ markdown: "x", migrated: true });
    expect(JSON.parse(wrap("pad", {}, migrations)).v).toBe(2);
  });

  it("marks chapters complete past the threshold and never un-completes on scroll back", () => {
    const s = mk();
    s.recordProgress("b", "c", { percent: 0.95 });
    s.recordProgress("b", "c", { percent: 0.2 });
    expect(s.progress("b").get().chapters.c).toMatchObject({ completed: true, percent: 0.2 });
  });

  it("toggles a chapter bookmark", () => {
    const s = mk();
    expect(s.toggleChapterBookmark("b", "c")).toBe(true);
    expect(s.toggleChapterBookmark("b", "c")).toBe(false);
    expect(s.bookmarks("b").get()).toEqual([]);
  });

  it("appendToPad drops the JSON cache so the editor re-parses markdown", () => {
    const s = mk();
    const scope = { kind: "global" } as const;
    s.savePad(scope, "first", { type: "doc" });
    s.appendToPad(scope, "> quote");
    expect(s.pad(scope).get()).toMatchObject({ markdown: "first\n\n> quote\n" });
    expect(s.pad(scope).get().json).toBeUndefined();
  });

  it("reports quota errors without throwing", () => {
    const onError = vi.fn();
    const adapter: StorageAdapter = {
      ...createMemoryAdapter(),
      set: (k) => {
        throw new StorageQuotaError(k);
      },
    };
    const s = createReaderStore({ adapter, writeDelay: 0, onError });
    s.updateSettings({ textSize: "sm" });
    expect(onError).toHaveBeenCalledWith(expect.any(StorageQuotaError));
    expect(s.settings().get().textSize).toBe("sm"); // in-memory value still updated
  });

  it("reloads cells when another tab writes (connect)", () => {
    const base = createMemoryAdapter();
    let notify: (k: string | null) => void = () => {};
    const adapter: StorageAdapter = { ...base, subscribe: (l) => ((notify = l), () => {}) };
    const s = mk(adapter);
    const dispose = s.connect();
    const cell = s.bookmarks("b");
    expect(cell.get()).toEqual([]);
    const other = mk(base);
    other.addBookmark({ bookId: "b", chapterId: "c" });
    notify("zr:v1:book:b:bookmarks");
    expect(cell.get()).toHaveLength(1);
    dispose();
  });
});

describe("backup", () => {
  it("round-trips and merges by id with last-write-wins", () => {
    const a = mk(createMemoryAdapter(), () => new Date("2026-01-01"));
    const h = a.addHighlight({ bookId: "b", chapterId: "c", anchor: anchor(0), note: "old" });
    const backup = exportBackup(a);
    expect(backup.format).toBe("zreader-backup");

    const b = mk(createMemoryAdapter(), () => new Date("2026-02-01"));
    importBackup(b, JSON.stringify(backup));
    expect(b.highlights("b").get()[0]!.note).toBe("old");

    b.updateHighlight("b", h.id, { note: "newer" });
    importBackup(b, backup); // older copy must not win
    expect(b.highlights("b").get()[0]!.note).toBe("newer");
    expect(b.highlights("b").get()).toHaveLength(1);
  });

  it("replace mode wipes existing data", () => {
    const a = mk();
    a.addBookmark({ bookId: "x", chapterId: "1" });
    const empty = exportBackup(mk());
    importBackup(a, empty, { mode: "replace" });
    expect(a.bookmarks("x").get()).toEqual([]);
  });

  it("can scope an export to one book", () => {
    const a = mk();
    a.addBookmark({ bookId: "one", chapterId: "1" });
    a.addBookmark({ bookId: "two", chapterId: "1" });
    a.savePad({ kind: "book", bookId: "one" }, "notes");
    expect(Object.keys(exportBackup(a, { bookId: "one" }).records).sort()).toEqual(["book:one:bookmarks", "pad:book:one"]);
  });

  it("still imports legacy alr-backup files", () => {
    const a = mk();
    a.addBookmark({ bookId: "old", chapterId: "1" });
    const legacy = { ...exportBackup(a), format: "alr-backup" };
    const b = mk();
    importBackup(b, JSON.stringify(legacy));
    expect(b.bookmarks("old").get()).toHaveLength(1);
  });

  it("rejects foreign files", () => {
    expect(() => importBackup(mk(), "{}")).toThrow(BackupFormatError);
    expect(() => importBackup(mk(), "nope")).toThrow(BackupFormatError);
  });
});
