/**
 * `zreader/content` — Astro-style content layer (server/build only).
 *
 *   const books = await getBooks();
 *   const { chapter } = await getChapter("my-book", "intro");
 *   const rendered = await renderChapter(chapter);
 */
import { mergeConfig, type ContentConfig, type ReaderUserConfig, type ResolvedReaderConfig } from "../config/index";
import type { BookMeta, ChapterMeta, TocEntry } from "../core/types";
import { compileChapter, loadBooks, type BookEntry, type ChapterEntry } from "./loader";
import { runMdx, type MdxContent } from "./pipeline";
import type { BlockInfo } from "../rehype/index";

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

async function globalConfig(): Promise<ResolvedReaderConfig> {
  const mod = await import("zreader/virtual-config");
  return mod.default;
}

const bookCache = new WeakMap<ResolvedReaderConfig, Promise<BookEntry[]>>();

function cachedBooks(config: ResolvedReaderConfig): Promise<BookEntry[]> {
  if (process.env.NODE_ENV === "development") return loadBooks(config); // always fresh in dev
  let p = bookCache.get(config);
  if (!p) {
    p = loadBooks(config);
    bookCache.set(config, p);
    p.catch(() => bookCache.delete(config));
  }
  return p;
}

function createApi(getConfig: () => Promise<ResolvedReaderConfig>) {
  const api = {
    config: getConfig,

    async getBooks(): Promise<BookEntry[]> {
      return cachedBooks(await getConfig());
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
      const compiled = await compileChapter(entry, await getConfig());
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

const defaultApi = createApi(globalConfig);

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
 */
export function defineBooks(inline: InlineContent | ResolvedReaderConfig = {}) {
  if (inline && "root" in inline && "reader" in inline) {
    const resolved = inline as ResolvedReaderConfig;
    return createApi(async () => resolved);
  }
  let memo: Promise<ResolvedReaderConfig> | undefined;
  return createApi(
    () =>
      (memo ??= globalConfig().then((g) => ({
        ...g,
        content: mergeConfig<ContentConfig>(g.content, inline),
      }))),
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
export type { ReaderUserConfig, ResolvedReaderConfig, SanitizeOptions, ContentConfig, GlobLoader } from "../config/index";
