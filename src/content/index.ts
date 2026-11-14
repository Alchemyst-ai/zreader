/**
 * `zreader/content` — Astro-style content layer (server/build only).
 *
 *   const books = await getBooks();
 *   const { chapter } = await getChapter("my-book", "intro");
 *   const rendered = await renderChapter(chapter);
 *
 * With more than one bookshelf, scope the calls to one:
 *
 *   const books = await getShelf("reports").getBooks();
 */
import {
  defaultShelfOf,
  mergeConfig,
  shelfById,
  type ContentConfig,
  type ReaderUserConfig,
  type ResolvedReaderConfig,
  type ResolvedShelf,
} from "../config/index";
import type { BookMeta, ChapterMeta, TocEntry } from "../core/types";
import { compileChapter, loadBooks, type BookEntry, type ChapterEntry } from "./loader";
import { runMdx, type MdxContent } from "./pipeline";
import type { BlockInfo } from "../rehype/index";
import type { AgentContentSource } from "../agent/handler";

export type RenderedChapter =
  | { kind: "html"; html: string; toc: TocEntry[]; blocks: BlockInfo[]; contentHash: string }
  | { kind: "mdx"; Content: MdxContent; toc: TocEntry[]; blocks: BlockInfo[]; contentHash: string };

export interface ChapterLookup {
  book: BookEntry;
  chapter: ChapterEntry;
  index: number;
  prev: ChapterMeta | null;
  next: ChapterMeta | null;
}

/** A shelf plus the project root the content paths resolve against. */
interface ShelfHandle {
  root: string;
  shelf: ResolvedShelf;
}

/** The content API for one shelf. */
export interface ShelfApi extends AgentContentSource {
  /** The resolved shelf this API reads. */
  shelf(): Promise<ResolvedShelf>;
  /** Plain, serializable book metadata (safe to pass to client components). */
  getBookMetas(): Promise<BookMeta[]>;
  renderChapter(entry: ChapterEntry): Promise<RenderedChapter>;
  /** For `generateStaticParams`. Param names are configurable. */
  getStaticParams<B extends string = "book", C extends string = "chapter">(
    names?: { book?: B; chapter?: C },
  ): Promise<Array<Record<B | C, string>>>;
}

async function globalConfig(): Promise<ResolvedReaderConfig> {
  const mod = await import("zreader/virtual-config");
  return mod.default;
}

function configOf(handle: ShelfHandle): ResolvedReaderConfig {
  return { root: handle.root, content: handle.shelf.content, reader: handle.shelf.reader, shelves: [handle.shelf], defaultShelf: handle.shelf.id };
}

/** Book caches are per shelf, so two shelves never share a catalogue. */
const bookCache = new WeakMap<ResolvedShelf, Promise<BookEntry[]>>();

function cachedBooks(handle: ShelfHandle): Promise<BookEntry[]> {
  if (process.env.NODE_ENV === "development") return loadBooks(configOf(handle)); // always fresh in dev
  let p = bookCache.get(handle.shelf);
  if (!p) {
    p = loadBooks(configOf(handle));
    bookCache.set(handle.shelf, p);
    p.catch(() => bookCache.delete(handle.shelf));
  }
  return p;
}

function createApi(getHandle: () => Promise<ShelfHandle>) {
  const api: ShelfApi = {
    shelf: async () => (await getHandle()).shelf,

    async getBooks(): Promise<BookEntry[]> {
      return cachedBooks(await getHandle());
    },

    /** Plain, serializable book metadata (safe to pass to client components). */
    async getBookMetas(): Promise<BookMeta[]> {
      return (await api.getBooks()).map(toBookMeta);
    },

    async getBook(bookId: string): Promise<BookEntry | null> {
      return (await api.getBooks()).find((b) => b.id === bookId) ?? null;
    },

    async getChapter(bookId: string, chapterId: string): Promise<ChapterLookup | null> {
      const book = await api.getBook(bookId);
      if (!book) return null;
      const index = book.chapterEntries.findIndex((c) => c.id === chapterId);
      if (index < 0) return null;
      return {
        book,
        chapter: book.chapterEntries[index]!,
        index,
        prev: book.chapters[index - 1] ?? null,
        next: book.chapters[index + 1] ?? null,
      };
    },

    async renderChapter(entry: ChapterEntry): Promise<RenderedChapter> {
      const compiled = await compileChapter(entry, configOf(await getHandle()));
      if (compiled.kind === "mdx") {
        const { code, ...rest } = compiled;
        return { ...rest, kind: "mdx", Content: await runMdx(code) };
      }
      return compiled;
    },

    /** For `generateStaticParams`. Param names are configurable. */
    async getStaticParams<B extends string = "book", C extends string = "chapter">(
      names: { book?: B; chapter?: C } = {},
    ): Promise<Array<Record<B | C, string>>> {
      const b = (names.book ?? "book") as B;
      const c = (names.chapter ?? "chapter") as C;
      const out: Array<Record<B | C, string>> = [];
      for (const book of await api.getBooks()) {
        for (const ch of book.chapterEntries) out.push({ [b]: book.id, [c]: ch.id } as Record<B | C, string>);
      }
      return out;
    },
  };
  return api;
}

export function toBookMeta(book: BookEntry): BookMeta {
  return {
    id: book.id,
    title: book.title,
    ...(book.subtitle ? { subtitle: book.subtitle } : {}),
    authors: book.authors,
    ...(book.description ? { description: book.description } : {}),
    ...(book.cover ? { cover: book.cover } : {}),
    chapters: book.chapters,
  };
}

const shelfApis = new Map<string, ShelfApi>();

/**
 * The content API for one bookshelf. The default shelf when `id` is omitted.
 *
 *   await getShelf("reports").getBooks();
 */
export function getShelf(id?: string): ShelfApi {
  const key = id ?? "";
  let api = shelfApis.get(key);
  if (!api) {
    api = createApi(async () => {
      const config = await globalConfig();
      const shelf = shelfById(config, id);
      if (!shelf) {
        throw new Error(
          `zreader: no bookshelf with id "${id}". Known: ${config.shelves.map((s) => s.id).join(", ") || "(none)"}.`,
        );
      }
      return { root: config.root, shelf };
    });
    shelfApis.set(key, api);
  }
  return api;
}

/** Every resolved bookshelf, in declaration order. */
export async function getShelves(): Promise<ResolvedShelf[]> {
  return (await globalConfig()).shelves;
}

const defaultApi = getShelf();

export const getBooks = defaultApi.getBooks;
export const getBookMetas = defaultApi.getBookMetas;
export const getBook = defaultApi.getBook;
export const getChapter = defaultApi.getChapter;
export const renderChapter = defaultApi.renderChapter;
export const getStaticParams = defaultApi.getStaticParams;
export const getReaderConfig = globalConfig;

type InlineContent = ReaderUserConfig["content"];

/**
 * Inline form: merge content options on top of the global reader.config.ts.
 *
 *   export const handbook = defineBooks({ loader: glob({ base: "./content/handbook" }) });
 *   await handbook.getBooks();
 *
 * An escape hatch for content that is not a shelf (a script, a one-off loader).
 * It has no plugins and is not traced by `withReader`; for anything served over
 * HTTP, declare a bookshelf in reader.config.ts instead.
 */
export function defineBooks(inline: InlineContent | ResolvedReaderConfig = {}) {
  if (inline && "root" in inline && "reader" in inline) {
    const resolved = inline as ResolvedReaderConfig;
    const shelf = defaultShelfOf(resolved);
    return createApi(async () => ({ root: resolved.root, shelf }));
  }
  let memo: Promise<ShelfHandle> | undefined;
  return createApi(
    () =>
      (memo ??= globalConfig().then((g) => {
        const content = mergeConfig<ContentConfig>(g.content, inline);
        return { root: g.root, shelf: { ...defaultShelfOf(g), content, plugins: [] } };
      })),
  );
}

export { loadBooks, compileChapter, ContentError, type BookEntry, type ChapterEntry } from "./loader";
export {
  renderMarkdown,
  renderHtml,
  annotateHtml,
  compileMdx,
  runMdx,
  type HtmlResult,
  type MdxCompiled,
  type MdxContent,
  type MdxComponents,
  type ChapterFormat,
  type PipelineOptions,
} from "./pipeline";
export { sanitizeHtml } from "./sanitize";
export { rehypeBlocks, type BlockInfo, type BlocksData } from "../rehype/index";
export { hashString } from "../core/blocks";
export { glob, defineConfig, z } from "../config/index";
export type {
  ReaderUserConfig,
  ResolvedReaderConfig,
  ResolvedShelf,
  BookshelfConfig,
  SanitizeOptions,
  ContentConfig,
  GlobLoader,
} from "../config/index";
