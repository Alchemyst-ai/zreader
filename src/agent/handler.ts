/**
 * Framework-agnostic `Request → Response` handler that serves agent-readable
 * Markdown next to the reader's HTML pages:
 *
 *   {basePath}.md                 → the shelf
 *   {basePath}/:book.md           → a book's table of contents
 *   {basePath}/:book/:chapter.md  → a chapter
 *   /llms.txt                     → an llms.txt index
 *
 * Returns `undefined` for any other request, so it composes with your own
 * middleware / proxy / router.
 */
import type { BookEntry, ChapterLookup } from "zreader/content";
import { bookToMarkdown, chapterToMarkdown, llmsTxt, markdownPageUrl, pageUrl, shelfToMarkdown, type AgentUrlContext, type LlmsTxtOptions } from "./markdown";

/** The slice of the content API the handler needs (`zreader/content` or `defineBooks()`). */
export interface AgentContentSource {
  getBooks(): Promise<BookEntry[]>;
  getBook(bookId: string): Promise<BookEntry | null>;
  getChapter(bookId: string, chapterId: string): Promise<ChapterLookup | null>;
}

export interface AgentHandlerOptions {
  /** Defaults to `reader.basePath` from reader.config.ts ("/books"). */
  basePath?: string;
  /** Defaults to the global content layer (`zreader/content`). */
  api?: AgentContentSource;
  /**
   * Absolute origin for links, e.g. "https://press.example.com". Recommended in
   * production. Defaults to the request's `X-Forwarded-Host` / `Host` header.
   */
  origin?: string;
  /** Serve `/llms.txt` (default true), optionally with a custom title/summary. */
  llms?: boolean | LlmsTxtOptions;
  /** Cache-Control header for successful responses. */
  cacheControl?: string;
}

export type AgentHandler = (request: Request) => Promise<Response | undefined>;

const DEFAULT_CACHE = "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400";

function decode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

type Route =
  | { kind: "shelf" }
  | { kind: "book"; book: string }
  | { kind: "chapter"; book: string; chapter: string }
  | { kind: "llms" };

/** Match a pathname against the agent routes (pure; exported for tests and custom routers). */
export function matchAgentRoute(pathname: string, basePath: string, llms = true): Route | null {
  if (llms && pathname === "/llms.txt") return { kind: "llms" };
  if (!pathname.endsWith(".md")) return null;
  const base = basePath.replace(/\/+$/, "");
  if (pathname === (base ? `${base}.md` : "/index.md")) return { kind: "shelf" };
  if (!pathname.startsWith(`${base}/`)) return null;
  const rest = pathname.slice(base.length + 1, -3).split("/");
  const segs = rest.map(decode);
  if (segs.some((s) => !s)) return null;
  if (segs.length === 1) return { kind: "book", book: segs[0]! };
  if (segs.length === 2) return { kind: "chapter", book: segs[0]!, chapter: segs[1]! };
  return null;
}

function first(value: string | null): string | undefined {
  return value?.split(",")[0]?.trim() || undefined;
}

/** Public origin of a request: forwarded headers first (proxies, `next start`), then its URL. */
export function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const host = first(request.headers.get("x-forwarded-host")) ?? first(request.headers.get("host"));
  if (!host || !/^[\w.-]+(:\d+)?$|^\[[\da-f:]+\](:\d+)?$/i.test(host)) return url.origin;
  const proto = first(request.headers.get("x-forwarded-proto")) ?? url.protocol.replace(/:$/, "");
  return `${proto === "http" ? "http" : "https"}://${host}`;
}

async function defaultBasePath(): Promise<string> {
  const { getReaderConfig } = await import("zreader/content");
  return (await getReaderConfig()).reader.basePath;
}

async function defaultApi(): Promise<AgentContentSource> {
  const { getBooks, getBook, getChapter } = await import("zreader/content");
  return { getBooks, getBook, getChapter };
}

export function createAgentHandler(options: AgentHandlerOptions = {}): AgentHandler {
  const llmsOpts = options.llms === false ? null : options.llms === true || !options.llms ? {} : options.llms;
  const cacheControl = options.cacheControl ?? DEFAULT_CACHE;
  let basePathP: Promise<string> | undefined;
  let apiP: Promise<AgentContentSource> | undefined;

  return async (request) => {
    if (request.method !== "GET" && request.method !== "HEAD") return undefined;
    const url = new URL(request.url);
    const basePath = await (basePathP ??= options.basePath != null ? Promise.resolve(options.basePath) : defaultBasePath());
    const route = matchAgentRoute(url.pathname, basePath, llmsOpts !== null);
    if (!route) return undefined;

    const api = await (apiP ??= options.api ? Promise.resolve(options.api) : defaultApi());
    const ctx: AgentUrlContext = { origin: (options.origin ?? requestOrigin(request)).replace(/\/+$/, ""), basePath };
    const head = request.method === "HEAD";

    const respond = (body: string, status = 200, canonical?: string, type = "text/markdown") => {
      const headers = new Headers({
        "Content-Type": `${type}; charset=utf-8`,
        "Cache-Control": status === 200 ? cacheControl : "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      if (canonical) headers.set("Link", `<${canonical}>; rel="canonical"`);
      return new Response(head ? null : body, { status, headers });
    };
    const notFound = (what: string) =>
      respond(`# Not found\n\nNo ${what} at \`${url.pathname}\`. See the [shelf](${markdownPageUrl(ctx)}).\n`, 404);

    switch (route.kind) {
      case "llms":
        return respond(llmsTxt(await api.getBooks(), ctx, llmsOpts ?? {}), 200, undefined, "text/plain");
      case "shelf":
        return respond(shelfToMarkdown(await api.getBooks(), ctx), 200, pageUrl(ctx));
      case "book": {
        const book = await api.getBook(route.book);
        return book ? respond(bookToMarkdown(book, ctx), 200, pageUrl(ctx, book.id)) : notFound("book");
      }
      case "chapter": {
        const hit = await api.getChapter(route.book, route.chapter);
        return hit
          ? respond(await chapterToMarkdown(hit, ctx), 200, pageUrl(ctx, hit.book.id, hit.chapter.id))
          : notFound("chapter");
      }
    }
  };
}
