/**
 * Images the reader adds (pasted into the scratchpad or a note), stored as
 * blobs in IndexedDB. localStorage holds strings up to ~5 MB, so binary data
 * lives here and records refer to it as `zr-blob:<id>`.
 *
 * Ids are content hashes, so the same image pasted twice is stored once.
 * Unreferenced blobs are removed by `collectGarbage()`. No Node APIs.
 */

import type { ReaderStore } from "./store";

export const BLOB_SCHEME = "zr-blob:";
const BLOB_REF = /zr-blob:([a-z0-9_-]{8,128})/gi;

export interface BlobInfo {
  id: string;
  type: string;
  size: number;
  createdAt: string;
}

export interface StoredBlob extends BlobInfo {
  blob: Blob;
}

export interface BlobUsage {
  count: number;
  /** Bytes used by stored images. */
  bytes: number;
  /** The origin's quota and usage (`navigator.storage.estimate()`), when known. */
  quota?: number;
  usage?: number;
}

export interface BlobStore {
  /** `"indexeddb"` or `"memory"` (SSR, tests, private modes without IndexedDB). */
  readonly kind: "indexeddb" | "memory";
  /** Stores a blob and returns its id (a content hash, or `id` when given: backups keep theirs). */
  put(blob: Blob, id?: string): Promise<string>;
  get(id: string): Promise<StoredBlob | null>;
  list(): Promise<BlobInfo[]>;
  delete(id: string): Promise<void>;
  /** An object URL for `id`, or `null` when it isn't stored. Shared; call `release(id)` once per `url(id)`. */
  url(id: string): Promise<string | null>;
  /** Revokes the object URL once every `url(id)` caller has released it. */
  release(id: string): void;
  usage(): Promise<BlobUsage>;
  /** Fires after every put/delete (for UIs that show usage). */
  subscribe(listener: () => void): () => void;
}

export class BlobTooLargeError extends Error {
  constructor(
    public readonly size: number,
    public readonly max: number,
  ) {
    super(`Image is ${(size / 1048576).toFixed(1)} MB; the limit is ${(max / 1048576).toFixed(1)} MB`);
    this.name = "BlobTooLargeError";
  }
}

export function blobUrl(id: string): string {
  return `${BLOB_SCHEME}${id}`;
}

/** `zr-blob:<id>` → `<id>`, else `null`. */
export function parseBlobUrl(src: string | null | undefined): string | null {
  if (!src?.startsWith(BLOB_SCHEME)) return null;
  const id = src.slice(BLOB_SCHEME.length);
  return /^[a-z0-9_-]{8,128}$/i.test(id) ? id : null;
}

/** Every `zr-blob:` id mentioned in `text`. */
export function findBlobRefs(text: string, into: Set<string> = new Set()): Set<string> {
  for (const m of text.matchAll(BLOB_REF)) into.add(m[1]!.toLowerCase());
  return into;
}

function validId(id: string | undefined): string | undefined {
  if (id == null) return undefined;
  if (!/^[a-z0-9_-]{8,128}$/i.test(id)) throw new Error(`Invalid blob id "${id}"`);
  return id.toLowerCase();
}

async function hashBlob(blob: Blob): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const digest = await subtle.digest("SHA-256", await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest).slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Insecure contexts have no SubtleCrypto: fall back to a random id (no dedupe).
  return Array.from({ length: 4 }, () => Math.floor(Math.random() * 2 ** 32).toString(16).padStart(8, "0")).join("");
}

/** Object URLs, shared and reference-counted: each `url()` needs a matching `release()`. */
function createUrlCache(load: (id: string) => Promise<StoredBlob | null>) {
  const urls = new Map<string, { p: Promise<string | null>; refs: number }>();
  return {
    url(id: string) {
      let e = urls.get(id);
      if (!e) {
        e = {
          p: load(id).then((s) => (s && typeof URL !== "undefined" && URL.createObjectURL ? URL.createObjectURL(s.blob) : null)),
          refs: 0,
        };
        urls.set(id, e);
      }
      e.refs++;
      return e.p;
    },
    release(id: string) {
      const e = urls.get(id);
      if (!e || --e.refs > 0) return;
      urls.delete(id);
      void e.p.then((u) => u && URL.revokeObjectURL?.(u));
    },
    drop(id: string) {
      const e = urls.get(id);
      urls.delete(id);
      void e?.p.then((u) => u && URL.revokeObjectURL?.(u));
    },
  };
}

function emitter() {
  const listeners = new Set<() => void>();
  return {
    emit: () => listeners.forEach((l) => l()),
    subscribe(l: () => void) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
  };
}

async function estimate(): Promise<{ quota?: number; usage?: number }> {
  try {
    const e = await globalThis.navigator?.storage?.estimate?.();
    return e ? { quota: e.quota, usage: e.usage } : {};
  } catch {
    return {};
  }
}

export function createMemoryBlobStore(): BlobStore {
  const items = new Map<string, StoredBlob>();
  const ev = emitter();
  const cache = createUrlCache(async (id) => items.get(id) ?? null);
  return {
    kind: "memory",
    async put(blob, given) {
      const id = validId(given) ?? (await hashBlob(blob));
      if (!items.has(id)) items.set(id, { id, type: blob.type, size: blob.size, createdAt: new Date().toISOString(), blob });
      ev.emit();
      return id;
    },
    async get(id) {
      return items.get(id) ?? null;
    },
    async list() {
      return [...items.values()].map(({ blob: _b, ...info }) => info);
    },
    async delete(id) {
      items.delete(id);
      cache.drop(id);
      ev.emit();
    },
    url: cache.url,
    release: cache.release,
    async usage() {
      let bytes = 0;
      for (const v of items.values()) bytes += v.size;
      return { count: items.size, bytes, ...(await estimate()) };
    },
    subscribe: ev.subscribe,
  };
}

const STORE = "blobs";

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

let persistAsked = false;

/** IndexedDB store named `<prefix>:blobs`. Falls back to memory when IndexedDB is unavailable. */
export function createIndexedDbBlobStore(prefix: string, idb: IDBFactory | undefined = globalThis.indexedDB): BlobStore {
  if (!idb) return createMemoryBlobStore();
  let dbP: Promise<IDBDatabase> | undefined;
  const open = () =>
    (dbP ??= new Promise<IDBDatabase>((resolve, reject) => {
      const r = idb.open(`${prefix}:blobs`, 1);
      r.onupgradeneeded = () => {
        if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: "id" });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => {
        dbP = undefined;
        reject(r.error);
      };
    }));
  const ev = emitter();
  // Rows hold an ArrayBuffer, not a Blob: storing Blobs is unreliable in some engines (older Safari).
  type Row = BlobInfo & { data: ArrayBuffer };
  const get = async (id: string): Promise<StoredBlob | null> => {
    const row = (await req((await open()).transaction(STORE).objectStore(STORE).get(id))) as Row | undefined;
    if (!row) return null;
    const { data, ...info } = row;
    return { ...info, blob: new Blob([data], { type: info.type }) };
  };
  const cache = createUrlCache(get);

  return {
    kind: "indexeddb",
    async put(blob, given) {
      const id = validId(given) ?? (await hashBlob(blob));
      const data = await blob.arrayBuffer();
      const db = await open();
      const tx = db.transaction(STORE, "readwrite");
      const os = tx.objectStore(STORE);
      const existing = await req(os.getKey(id));
      if (existing === undefined) os.put({ id, type: blob.type, size: blob.size, createdAt: new Date().toISOString(), data } satisfies Row);
      await done(tx);
      if (!persistAsked) {
        persistAsked = true;
        void globalThis.navigator?.storage?.persist?.().catch(() => {});
      }
      ev.emit();
      return id;
    },
    get,
    async list() {
      const all = (await req((await open()).transaction(STORE).objectStore(STORE).getAll())) as Row[];
      return all.map(({ data: _d, ...info }) => info);
    },
    async delete(id) {
      const tx = (await open()).transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      await done(tx);
      cache.drop(id);
      ev.emit();
    },
    url: cache.url,
    release: cache.release,
    async usage() {
      const all = (await req((await open()).transaction(STORE).objectStore(STORE).getAll())) as Row[];
      return { count: all.length, bytes: all.reduce((n, b) => n + b.size, 0), ...(await estimate()) };
    },
    subscribe: ev.subscribe,
  };
}

/** The default store for a storage prefix: IndexedDB in browsers, memory elsewhere. */
export function createBlobStore(prefix: string): BlobStore {
  return typeof window !== "undefined" ? createIndexedDbBlobStore(prefix) : createMemoryBlobStore();
}

/** `1536` → `"1.5 KB"`. */
export function formatStorageBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

// ---------------------------------------------------------------- encoding

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function base64ToBlob(data: string, type: string): Blob {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** `data:image/png;base64,…` → a Blob, or `null` for anything else. */
export function dataUriToBlob(uri: string): Blob | null {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/is.exec(uri.trim());
  if (!m) return null;
  try {
    return base64ToBlob(m[2]!.replace(/\s+/g, ""), m[1]!.toLowerCase());
  } catch {
    return null;
  }
}

// ------------------------------------------------------- garbage collection

/** Every blob id the reader's records (scratchpads, notes) refer to. */
export function referencedBlobs(store: Pick<ReaderStore, "keys" | "adapter" | "flush">): Set<string> {
  store.flush();
  const out = new Set<string>();
  for (const key of store.keys()) findBlobRefs(store.adapter.get(key) ?? "", out);
  return out;
}

export interface CollectGarbageOptions {
  /** Keep blobs newer than this (an editor may not have saved yet, or undo may bring one back). Default 24 h. */
  graceMs?: number;
  now?: number;
}

/**
 * Delete blobs no record refers to. `referenced` is every id still in use
 * (see `ReaderStore.blobRefs()`). Returns the deleted ids.
 */
export async function collectGarbage(blobs: BlobStore, referenced: Set<string>, opts: CollectGarbageOptions = {}): Promise<string[]> {
  const grace = opts.graceMs ?? 24 * 60 * 60 * 1000;
  const now = opts.now ?? Date.now();
  const removed: string[] = [];
  for (const b of await blobs.list()) {
    if (referenced.has(b.id.toLowerCase())) continue;
    if (now - Date.parse(b.createdAt) < grace) continue;
    await blobs.delete(b.id);
    removed.push(b.id);
  }
  return removed;
}
