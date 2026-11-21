import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { ThemeProvider } from "next-themes";
import {
  DEFAULT_CLIENT_OPTIONS,
  createLocalStorageAdapter,
  createReaderStore,
  createBlobStore,
  connectSandbox,
  parseBlobUrl,
  type BlobStore,
  type MathLoader,
  type SandboxConnection,
  type SandboxLoader,
  type BlobUsage,
  type Cell,
  type ReaderStore,
  type StorageAdapter,
  type Bookmark,
  type BookProgress,
  type Highlight,
  type Pad,
  type PadScope,
  type ReaderClientOptions,
  type ReaderSettings,
} from "zreader";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { BookMeta } from "zreader";
import { DefaultImage, DefaultLink, defaultHref, type ImageComponent, type LinkComponent } from "./link";
import { Toaster } from "@/components/ui/sonner";

type DeepPartial<T> = T extends unknown[] ? T : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

function isPlainObject(x: unknown): x is Record<string, unknown> {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return false;
  const proto = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
}

/** Deep merge for client options (arrays replace). Kept here so zod stays out of the client bundle. */
export function mergeOptions<T>(base: T, ...overrides: unknown[]): T {
  const merge = (a: unknown, b: unknown): unknown => {
    if (b === undefined || b === null) return a;
    if (isPlainObject(a) && isPlainObject(b)) {
      const out: Record<string, unknown> = { ...a };
      for (const [k, v] of Object.entries(b)) out[k] = merge(a[k], v);
      return out;
    }
    return b;
  };
  return overrides.reduce<unknown>(merge, base) as T;
}

/** Builds a link into the reader. `chapterId` omitted = the book's contents page. */
export type HrefFor = (bookId: string, chapterId?: string, hash?: string) => string;

/** What the reader shows in the middle of its top bar. */
export type HeaderSlot = ReactNode | ((ctx: { book: BookMeta; chapter: { id: string; title: string } }) => ReactNode);

export interface Library {
  /** Every book known to the provider (from `books`). */
  books: BookMeta[];
  getBook(id: string): BookMeta | undefined;
  Link: LinkComponent;
  /** Renders book covers. Defaults to <img>; next/image under `zreader/next/client`. */
  Image: ImageComponent;
  href: HrefFor;
  headerSlot?: HeaderSlot;
  readerActions?: ReactNode;
}

interface ReaderContextValue {
  store: ReaderStore;
  /** Images readers add (IndexedDB). */
  blobs: BlobStore;
  /** Renders TeX in the scratchpad, when the app provides an engine. */
  math: MathLoader | null;
  setMath: (loader: MathLoader | null) => void;
  /** Runs RunnableCode, when the app provides a Sandbox. */
  sandbox: SandboxConnection | null;
  setSandbox: (loader: SandboxLoader | null) => void;
  options: ReaderClientOptions;
  library: Library;
}

const ReaderContext = createContext<ReaderContextValue | null>(null);

/** Fires at most once per process (§10.3). */
let warnedMount = false;

export interface ReaderProviderProps {
  /** Usually `config.reader` from reader.config.ts (see <ReaderRoot>). */
  options?: DeepPartial<ReaderClientOptions>;
  /** Inline overrides, merged on top of `options`. */
  overrides?: DeepPartial<ReaderClientOptions>;
  adapter?: StorageAdapter;
  /** Provide your own store (advanced; e.g. tests). */
  store?: ReaderStore;
  onStorageError?: (error: unknown) => void;
  /** Where reader-added images are kept. Defaults to IndexedDB (`<storagePrefix>:blobs`). */
  blobStore?: BlobStore;
  /**
   * Math in the scratchpad: a loader for a TeX → MathML renderer, such as
   * `loadMath` from `zreader/math/katex`. Or render `<ScratchpadMath />` inside the provider.
   */
  math?: MathLoader;
  /**
   * RunnableCode in the scratchpad: a Sandbox that runs it, such as
   * `browserSandbox()` from `zreader/sandbox/browser`. Or render
   * `<ScratchpadSandbox />` inside the provider. Without one, RunnableCode
   * shows as plain code blocks.
   */
  sandbox?: SandboxLoader;
  /**
   * Manage the colour theme with next-themes (class on <html>, no-flash script).
   * Set to `false` if your app already renders a next-themes <ThemeProvider>.
   */
  manageTheme?: boolean;
  /** Render a sonner <Toaster>. Set to `false` if your app already has one. */
  toaster?: boolean;
  /**
   * The catalogue: lets <BookShelf />, <BookHome book="id" /> and
   * <Reader book="id" chapter="id" /> work from ids alone.
   */
  books?: BookMeta[];
  /** Router link used by every component (e.g. next/link). Defaults to <a>. */
  Link?: LinkComponent;
  /** Image component for book covers (e.g. next/image). Defaults to <img>. */
  Image?: ImageComponent;
  /** URL builder. Defaults to `${basePath}/${bookId}/${chapterId}#hash`. */
  hrefFor?: HrefFor;
  /**
   * Default content for the middle of the reader's top bar: text, your logo,
   * or any component. Omit to show the book and chapter titles.
   */
  headerSlot?: HeaderSlot;
  /**
   * Default buttons for the right of the reader's top bar (before the bookmark
   * toggle), e.g. `<CopyReference markdown />`. A <Reader>'s `actions` replaces
   * them; `actions={null}` hides them for that chapter.
   */
  readerActions?: ReactNode;
  children: ReactNode;
}

export function ReaderProvider({
  options,
  overrides,
  adapter,
  store: external,
  onStorageError,
  blobStore,
  math: mathProp,
  sandbox: sandboxProp,
  manageTheme = true,
  toaster = true,
  books,
  Link,
  Image,
  hrefFor,
  headerSlot,
  readerActions,
  children,
}: ReaderProviderProps) {
  const key = JSON.stringify([options ?? null, overrides ?? null]);
  const resolved = useMemo(
    () => mergeOptions(DEFAULT_CLIENT_OPTIONS, options, overrides),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  const [store] = useState<ReaderStore>(
    () =>
      external ??
      createReaderStore({ adapter: adapter ?? createLocalStorageAdapter(), options: resolved, onError: onStorageError }),
  );
  useEffect(() => store.connect(), [store]);
  const [blobs] = useState<BlobStore>(() => blobStore ?? createBlobStore(resolved.storagePrefix));
  const [registered, setMath] = useState<MathLoader | null>(null);
  const math = mathProp ?? registered;
  const setMathLoader = useCallback((l: MathLoader | null) => setMath(() => l), []);
  const [registeredSandbox, setRegisteredSandbox] = useState<SandboxLoader | null>(null);
  const sandboxLoader = sandboxProp ?? registeredSandbox;
  const setSandbox = useCallback((l: SandboxLoader | null) => setRegisteredSandbox(() => l), []);
  // The provider owns the connection: one client per loader, disposed when the loader goes away.
  const sandbox = useMemo(() => (sandboxLoader ? connectSandbox(sandboxLoader) : null), [sandboxLoader]);
  useEffect(() => () => sandbox?.dispose(), [sandbox]);
  const library = useMemo<Library>(() => {
    const list = books ?? [];
    const byId = new Map(list.map((b) => [b.id, b]));
    return {
      books: list,
      getBook: (id) => byId.get(id),
      Link: Link ?? DefaultLink,
      Image: Image ?? DefaultImage,
      href: hrefFor ?? ((b, c, h) => defaultHref(resolved.basePath, b, c, h)),
      headerSlot,
      readerActions,
    };
  }, [books, Link, Image, hrefFor, headerSlot, readerActions, resolved.basePath]);
  const value = useMemo(
    () => ({ store, blobs, math, setMath: setMathLoader, sandbox, setSandbox, options: resolved, library }),
    [store, blobs, math, setMathLoader, sandbox, setSandbox, resolved, library],
  );

  // §10.3: outside its basePath every `hrefFor` link is wrong (a renamed
  // basePath without a renamed app/ folder). Development only, once per process.
  useEffect(() => {
    if (process.env.NODE_ENV !== "development" || typeof window === "undefined") return;
    if (warnedMount) return;
    warnedMount = true;
    const path = window.location.pathname;
    const base = resolved.basePath.replace(/\/+$/, "");
    if (base && path !== base && !path.startsWith(`${base}/`)) {
      const mount = `/${path.split("/").filter(Boolean)[0] ?? ""}`;
      const target = base || "/";
      console.warn(
        `[zreader] This reader's basePath is "${resolved.basePath}", but it is mounted at ${path}.\n` +
          `          Rename app${mount}/ to app${target}/, or set basePath back to "${mount}".`,
      );
    }
  }, [resolved.basePath]);

  const tree = (
    <ReaderContext.Provider value={value}>
      <TooltipProvider delayDuration={400}>
        {children}
        {toaster && <Toaster position="top-center" />}
      </TooltipProvider>
    </ReaderContext.Provider>
  );

  if (!manageTheme) return tree;
  return (
    <ThemeProvider
      attribute="class"
      themes={resolved.themes.filter((t) => t !== "system")}
      enableSystem={resolved.themes.includes("system")}
      defaultTheme={resolved.defaultTheme}
      storageKey={`${resolved.storagePrefix}:v1:theme`}
      disableTransitionOnChange
    >
      {tree}
    </ThemeProvider>
  );
}

export function useReader(): ReaderContextValue {
  const ctx = useContext(ReaderContext);
  if (!ctx) throw new Error("zreader: wrap your tree in <ReaderProvider> (or <ReaderRoot>).");
  return ctx;
}

/** The provider's catalogue, link component and URL builder. */
export function useLibrary(): Library {
  return useReader().library;
}

/**
 * Resolve a book given as an id (looked up in the provider's `books`) or as
 * metadata. Throws a descriptive error when an id is unknown.
 */
export function useBook(book: BookMeta | string): BookMeta {
  const { getBook, books } = useLibrary();
  if (typeof book !== "string") return book;
  const found = getBook(book);
  if (!found) {
    throw new Error(
      books.length
        ? `zreader: no book with id "${book}" in <ReaderProvider books>. Known: ${books.map((b) => b.id).join(", ")}.`
        : `zreader: <… book="${book}"> needs the catalogue. Pass books to <ReaderProvider books={…}> (or use <ReaderRoot>, which loads them).`,
    );
  }
  return found;
}

export function useReaderStore(): ReaderStore {
  return useReader().store;
}

/** The scratchpad's math loader, or `null` when the app provides none. */
export function useMathLoader(): MathLoader | null {
  return useReader().math;
}

/** Turn on math in the scratchpad with `loader` while the calling component is mounted. */
export function useRegisterMath(loader: MathLoader) {
  const { setMath } = useReader();
  useEffect(() => {
    setMath(loader);
    return () => setMath(null);
  }, [setMath, loader]);
}

/** The Sandbox that runs RunnableCode, or `null` when the app provides none. */
export function useSandbox(): SandboxConnection | null {
  return useReader().sandbox;
}

/** Turn on RunnableCode with `loader` while the calling component is mounted. */
export function useRegisterSandbox(loader: SandboxLoader) {
  const { setSandbox } = useReader();
  useEffect(() => {
    setSandbox(loader);
    return () => setSandbox(null);
  }, [setSandbox, loader]);
}

export function useBlobStore(): BlobStore {
  return useReader().blobs;
}

/**
 * Resolves `zr-blob:<id>` to an object URL (released on unmount); any other
 * `src` is returned unchanged. `undefined` while loading, `null` when missing.
 */
export function useBlobUrl(src: string | null | undefined): string | null | undefined {
  const blobs = useBlobStore();
  const id = parseBlobUrl(src);
  const [url, setUrl] = useState<string | null | undefined>(id ? undefined : (src ?? null));
  useEffect(() => {
    if (!id) {
      setUrl(src ?? null);
      return;
    }
    let live = true;
    setUrl(undefined);
    void blobs.url(id).then((u) => live && setUrl(u));
    return () => {
      live = false;
      blobs.release(id);
    };
  }, [blobs, id, src]);
  return url;
}

/** Image usage in IndexedDB, refreshed when images are added or removed. */
export function useBlobUsage(): BlobUsage | null {
  const blobs = useBlobStore();
  const [usage, setUsage] = useState<BlobUsage | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => void blobs.usage().then((u) => live && setUsage(u)).catch(() => {});
    load();
    const off = blobs.subscribe(load);
    return () => {
      live = false;
      off();
    };
  }, [blobs]);
  return usage;
}

function useCell<T>(cell: Cell<T>, serverValue: T): T {
  return useSyncExternalStore(cell.subscribe, cell.get, () => serverValue);
}

const noopSubscribe = () => () => {};
/** `false` during SSR and hydration, `true` afterwards. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

export function useSettings(): [ReaderSettings, ReaderStore["updateSettings"]] {
  const store = useReaderStore();
  const settings = useCell(store.settings(), store.server.settings);
  return [settings, store.updateSettings];
}

export function useHighlights(bookId: string, chapterId?: string): Highlight[] {
  const store = useReaderStore();
  const all = useCell(store.highlights(bookId), store.server.list as Highlight[]);
  return useMemo(() => (chapterId ? all.filter((h) => h.chapterId === chapterId) : all), [all, chapterId]);
}

export function useBookmarks(bookId: string): Bookmark[] {
  const store = useReaderStore();
  return useCell(store.bookmarks(bookId), store.server.list as Bookmark[]);
}

export function useProgress(bookId: string): BookProgress {
  const store = useReaderStore();
  return useCell(store.progress(bookId), store.server.progress(bookId));
}

export function usePad(scope: PadScope): Pad {
  const store = useReaderStore();
  return useCell(store.pad(scope), store.server.pad);
}

export function useMediaQuery(query: string, serverValue = false): boolean {
  return useSyncExternalStore(
    (cb) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener("change", cb);
      return () => mql.removeEventListener("change", cb);
    },
    () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : serverValue),
    () => serverValue,
  );
}

/** Desktop layout breakpoint (Tailwind `lg`). Mobile-first: `false` on the server. */
export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 1024px)", false);
}
