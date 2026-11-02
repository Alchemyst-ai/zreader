/** Pluggable key/value storage. localStorage by default, memory for SSR/tests. */
export interface StorageAdapter {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  keys(prefix?: string): string[];
  /** Notified when another tab/window changes `key` (or any key if `key` is null). */
  subscribe(listener: (key: string | null) => void): () => void;
}

export class StorageQuotaError extends Error {
  constructor(
    public readonly key: string,
    cause?: unknown,
  ) {
    super(`Storage quota exceeded while writing "${key}"`);
    this.name = "StorageQuotaError";
    (this as { cause?: unknown }).cause = cause;
  }
}

function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; code?: number };
  return (
    e.name === "QuotaExceededError" ||
    e.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    e.code === 22 ||
    e.code === 1014
  );
}

export function createMemoryAdapter(initial: Record<string, string> = {}): StorageAdapter & {
  dump(): Record<string, string>;
} {
  const map = new Map(Object.entries(initial));
  return {
    get: (k) => map.get(k) ?? null,
    set: (k, v) => void map.set(k, v),
    remove: (k) => void map.delete(k),
    keys: (prefix = "") => [...map.keys()].filter((k) => k.startsWith(prefix)),
    subscribe: () => () => {},
    dump: () => Object.fromEntries(map),
  };
}

/** Returns `null` when localStorage is unavailable (SSR, privacy mode, sandboxed iframes). */
export function getLocalStorage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    const probe = "__zr_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

export function createLocalStorageAdapter(storage: Storage | null = getLocalStorage()): StorageAdapter {
  if (!storage) return createMemoryAdapter();
  return {
    get: (k) => {
      try {
        return storage.getItem(k);
      } catch {
        return null;
      }
    },
    set: (k, v) => {
      try {
        storage.setItem(k, v);
      } catch (err) {
        if (isQuotaError(err)) throw new StorageQuotaError(k, err);
        throw err;
      }
    },
    remove: (k) => {
      try {
        storage.removeItem(k);
      } catch {
        /* ignore */
      }
    },
    keys: (prefix = "") => {
      const out: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k != null && k.startsWith(prefix)) out.push(k);
      }
      return out;
    },
    subscribe: (listener) => {
      if (typeof window === "undefined") return () => {};
      const onStorage = (e: StorageEvent) => {
        if (e.storageArea && e.storageArea !== storage) return;
        listener(e.key);
      };
      window.addEventListener("storage", onStorage);
      return () => window.removeEventListener("storage", onStorage);
    },
  };
}

/**
 * Ask the browser not to evict our data (Safari ITP / storage pressure).
 * Resolves to whether persistence is granted. Never throws.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
