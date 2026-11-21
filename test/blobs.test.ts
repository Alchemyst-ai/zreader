// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import {
  BackupFormatError,
  blobUrl,
  collectGarbage,
  createIndexedDbBlobStore,
  createMemoryAdapter,
  createMemoryBlobStore,
  createReaderStore,
  dataUriToBlob,
  exportBackupWithImages,
  findBlobRefs,
  importBackupWithImages,
  parseBackup,
  parseBlobUrl,
  referencedBlobs,
  type BlobStore,
} from "../src/core/index";
import { noteImages, noteText } from "../src/react/components/blob-image";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const png = () => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])], { type: "image/png" });
const jpg = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 9, 9])], { type: "image/jpeg" });

const anchor = { blockId: "p-1", blockStart: 0, start: 0, end: 5, exact: "hello", prefix: "", suffix: "" };
const mkStore = () => createReaderStore({ adapter: createMemoryAdapter(), writeDelay: 0 });

describe.each([
  ["memory", () => createMemoryBlobStore()],
  ["indexeddb", () => createIndexedDbBlobStore(`zr-test-${Math.random().toString(36).slice(2)}`)],
] as Array<[string, () => BlobStore]>)("%s blob store", (kind, make) => {
  it("stores by content hash, dedupes, lists and deletes", async () => {
    const blobs = make();
    expect(blobs.kind).toBe(kind);
    const a = await blobs.put(png());
    const b = await blobs.put(png());
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    await blobs.put(jpg());
    expect((await blobs.list()).length).toBe(2);
    const got = await blobs.get(a);
    expect(got).toMatchObject({ id: a, type: "image/png", size: 7 });
    expect(new Uint8Array(await got!.blob.arrayBuffer())[1]).toBe(0x50);
    expect(await blobs.usage()).toMatchObject({ count: 2, bytes: 12 });
    await blobs.delete(a);
    expect(await blobs.get(a)).toBeNull();
  });

  it("keeps a given id (backups) and rejects invalid ones", async () => {
    const blobs = make();
    expect(await blobs.put(png(), "fromabackup01")).toBe("fromabackup01");
    await expect(blobs.put(png(), "../x")).rejects.toThrow(/Invalid blob id/);
  });

  it("notifies subscribers", async () => {
    const blobs = make();
    let n = 0;
    const off = blobs.subscribe(() => n++);
    await blobs.put(png());
    off();
    await blobs.put(jpg());
    expect(n).toBe(1);
  });
});

describe("blob references", () => {
  it("parses zr-blob URLs and finds them in text", () => {
    expect(parseBlobUrl("zr-blob:abcdef1234")).toBe("abcdef1234");
    expect(parseBlobUrl("zr-blob:../x")).toBeNull();
    expect(parseBlobUrl("https://x")).toBeNull();
    expect([...findBlobRefs("![a](zr-blob:AAAAAAAA11) and zr-blob:bbbbbbbb22")]).toEqual(["aaaaaaaa11", "bbbbbbbb22"]);
  });

  it("collects references from pads and notes, and garbage-collects the rest", async () => {
    const store = mkStore();
    const blobs = createMemoryBlobStore();
    const used = await blobs.put(png());
    const unused = await blobs.put(jpg());
    const inNote = await blobs.put(new Blob([new Uint8Array([7, 7, 7])], { type: "image/gif" }));
    store.savePad({ kind: "global" }, `Notes ![d](${blobUrl(used)})`);
    store.addHighlight({ bookId: "b", chapterId: "c", anchor, color: "yellow", note: `see ![](${blobUrl(inNote)})` });
    expect(referencedBlobs(store)).toEqual(new Set([used, inNote]));
    // Within the grace period nothing is removed.
    expect(await collectGarbage(blobs, referencedBlobs(store))).toEqual([]);
    expect(await collectGarbage(blobs, referencedBlobs(store), { graceMs: 0 })).toEqual([unused]);
    expect((await blobs.list()).map((b) => b.id).sort()).toEqual([used, inNote].sort());
  });

  it("turns data URIs into blobs", () => {
    const b = dataUriToBlob("data:image/png;base64,iVBORw0KGgo=");
    expect(b?.type).toBe("image/png");
    expect(b?.size).toBe(8);
    expect(dataUriToBlob("data:text/html;base64,PHA+")).toBeNull();
  });

  it("previews notes without image markup", () => {
    const note = "Look ![chart](zr-blob:abcdef1234) and ![](zr-blob:0123456789).";
    expect(noteImages(note)).toEqual([
      { alt: "chart", src: "zr-blob:abcdef1234" },
      { alt: "", src: "zr-blob:0123456789" },
    ]);
    expect(noteText(note)).toBe("Look [image: chart] and [image].");
  });
});

describe("backup v2 with images", () => {
  it("embeds referenced images and restores them with their ids", async () => {
    const store = mkStore();
    const blobs = createMemoryBlobStore();
    const id = await blobs.put(png());
    await blobs.put(jpg()); // not referenced: not exported
    store.savePad({ kind: "global" }, `![x](${blobUrl(id)})`);
    const backup = await exportBackupWithImages(store, blobs);
    expect(backup.schemaVersion).toBe(2);
    expect(Object.keys(backup.blobs!)).toEqual([id]);
    expect(backup.blobs![id]).toMatchObject({ type: "image/png", size: 7 });

    const store2 = mkStore();
    const blobs2 = createMemoryBlobStore();
    const res = await importBackupWithImages(store2, blobs2, JSON.stringify(backup));
    expect(res).toMatchObject({ images: 1, imagesSkipped: 0 });
    expect(store2.pad({ kind: "global" }).get().markdown).toContain(blobUrl(id));
    const restored = await blobs2.get(id);
    expect(new Uint8Array(await restored!.blob.arrayBuffer())).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
  });

  it("still writes v1 without images, reads v1, and rejects malformed or newer backups", async () => {
    const store = mkStore();
    store.savePad({ kind: "global" }, "text only");
    const v1 = await exportBackupWithImages(store, createMemoryBlobStore());
    expect(v1.schemaVersion).toBe(1);
    expect(v1.blobs).toBeUndefined();
    expect(parseBackup(JSON.stringify(v1)).schemaVersion).toBe(1);
    expect(() => parseBackup({ ...v1, schemaVersion: 3 })).toThrow(BackupFormatError);
    expect(() => parseBackup({ ...v1, schemaVersion: 2, blobs: "x" })).toThrow(/images are malformed/);
  });

  it("skips bad image entries and removes unreferenced images on replace", async () => {
    const store = mkStore();
    const blobs = createMemoryBlobStore();
    const stale = await blobs.put(jpg());
    const backup = {
      format: "zreader-backup" as const,
      schemaVersion: 2,
      exportedAt: new Date().toISOString(),
      records: {},
      blobs: { goodimage01: { type: "image/png", size: 3, createdAt: "", data: "AAEC" }, badimage001: { type: "text/html", size: 1, createdAt: "", data: "PA==" } },
    };
    const res = await importBackupWithImages(store, blobs, backup, { mode: "replace" });
    expect(res).toMatchObject({ images: 1, imagesSkipped: 1 });
    // Nothing refers to any image after a replace with no records.
    expect(await blobs.get(stale)).toBeNull();
    expect(await blobs.get("goodimage01")).toBeNull();
  });
});

describe("scratchpad images", () => {
  it("round-trips zr-blob images through Markdown and shows them from IndexedDB", async () => {
    const { ReaderProvider } = await import("../src/react/index");
    const { ScratchpadEditor } = await import("../src/editor/index");
    const store = mkStore();
    const blobs = createMemoryBlobStore();
    const id = await blobs.put(png());
    const scope = { kind: "global" } as const;
    store.savePad(scope, `Before\n\n![diagram](${blobUrl(id)})\n\nAfter`);
    URL.createObjectURL ??= () => "blob:test";
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(h(ReaderProvider, { store, blobStore: blobs, manageTheme: false, toaster: false, children: h(ScratchpadEditor, { scope }) }));
    });
    await act(async () => new Promise((r) => setTimeout(r, 50)));
    const img = container.querySelector("img.zr-pad-image") as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img!.alt).toBe("diagram");
    expect(img!.getAttribute("src")).toMatch(/^blob:/);
    expect(container.querySelector('button[aria-label="Insert image"]')).not.toBeNull();
    await act(async () => root.unmount());
    container.remove();
  });
});
