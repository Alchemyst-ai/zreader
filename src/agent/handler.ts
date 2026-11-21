/**
 * Framework-agnostic `Request → Response` handler that serves agent-readable
 * Markdown next to the reader's HTML pages, one bookshelf at a time:
 *
 *   {basePath}.md                 → the shelf
 *   {basePath}/:book.md           → a book's table of contents
 *   {basePath}/:book/:chapter.md  → a chapter
 *
 * Everything else (frontmatter, `llms.txt`, the rich 404, CORS, MCP) is an
 * opt-in plugin from `zreader/plugins/agent` (§4).
 *
 * Returns `undefined` for any other request, so it composes with your own
 * middleware / proxy / router.
 */
import type { BookEntry, ChapterLookup } from "zreader/content";
import type { ResolvedShelf } from "../config/index";
import { serveAsset } from "../content/assets";
import type {
  AgentDocument,
  AgentPlugin,
  AgentPluginContext,
  AgentPluginMethod,
  AgentPluginRoute,
  NotFoundInfo,
} from "../plugins/agent/types";
import {
  bookToMarkdown,
  chapterToMarkdown,
  markdownPageUrl,
  newestBookLastUpdated,
  newestLastUpdated,
  pageUrl,
  resolveLastUpdated,
  shelfToMarkdown,
  type AgentUrlContext,
} from "./markdown";

/** The slice of the content API the handler needs (`zreader/content` or `defineBooks()`). */
export interface AgentContentSource {
  getBooks(): Promise<BookEntry[]>;
  getBook(bookId: string): Promise<BookEntry | null>;
  getChapter(bookId: string, chapterId: string): Promise<ChapterLookup | null>;
}

export interface AgentHandlerOptions {
  /** Shelf ids to serve. Defaults to every shelf in reader.config.ts. */
  shelves?: string[];
  /**
   * Absolute origin for links, e.g. "https://press.example.com". Recommended in
   * production. Defaults to the request's `X-Forwarded-Host` / `Host` header.
   */
  origin?: string;
  /** Cache-Control header for successful responses. */
  cacheControl?: string;
  /** Silence the development warnings (§10). */
  devWarnings?: boolean;
  /** Serve book assets (`{basePath}/{book}/_assets/…`, chapter images). Default `true`. */
  assets?: boolean;
  /** Advanced: serve a custom content source as a shelf (tests, non-file content). */
  sources?: Array<{ shelf: ResolvedShelf; api: AgentContentSource }>;
}

export type AgentHandler = (request: Request) => Promise<Response | undefined>;

export type AgentRouteMatch =
  | { kind: "shelf" }
  | { kind: "book"; book: string }
  | { kind: "chapter"; book: string; chapter: string };

const DEFAULT_CACHE = "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400";

const METHOD_ORDER: AgentPluginMethod[] = ["GET", "HEAD", "POST", "OPTIONS"];

function decode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** Match a pathname against the core agent routes (pure; exported for custom routers). */
export function matchAgentRoute(pathname: string, basePath: string): AgentRouteMatch | null {
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

function isDev() {
  return typeof process !== "undefined" && process.env?.NODE_ENV === "development";
}

/** `basePath` + a plugin's relative route path, collapsed. */
export function absoluteRoute(basePath: string, path: string): string {
  const base = basePath.replace(/\/+$/, "");
  const rest = path.startsWith("/") ? path : `/${path}`;
  return (base + rest).replace(/\/{2,}/g, "/");
}

// ---------------------------------------------------------------- runtime

interface RouteEntry {
  absolute: string;
  /** `"*"` routes match any path the shelf owns. */
  wildcard: boolean;
  methods: AgentPluginMethod[];
  route: AgentPluginRoute;
}

interface ShelfRuntime {
  shelf: ResolvedShelf;
  api: AgentContentSource;
  /** Normalized `basePath` (no trailing slash). */
  base: string;
  routes: RouteEntry[];
  root: RouteEntry[];
  plugins: AgentPlugin[];
}

interface Runtime {
  shelves: ShelfRuntime[];
  /** Root-level routes, outside every `basePath`, with their owning shelf. */
  roots: Array<RouteEntry & { owner: ShelfRuntime }>;
}

function toEntry(route: AgentPluginRoute, absolute: string, wildcard: boolean): RouteEntry {
  return { absolute, wildcard, methods: route.methods ?? ["GET", "HEAD"], route };
}

function pushShelf(out: Runtime, shelf: ResolvedShelf, api: AgentContentSource) {
  const base = shelf.basePath.replace(/\/+$/, "");
  const runtime: ShelfRuntime = { shelf, api, base, routes: [], root: [], plugins: shelf.plugins };
  for (const plugin of shelf.plugins) {
    for (const route of plugin.routes ?? []) {
      const wildcard = route.path === "*";
      runtime.routes.push(toEntry(route, wildcard ? "" : absoluteRoute(shelf.basePath, route.path), wildcard));
    }
    // A shelf mounted at "/" already serves these from its relative routes.
    if (base) {
      for (const route of plugin.rootRoutes ?? []) {
        const entry = toEntry(route, absoluteRoute("/", route.path), false);
        runtime.root.push(entry);
        out.roots.push({ ...entry, owner: runtime });
      }
    }
  }
  out.shelves.push(runtime);
}

async function buildRuntime(options: AgentHandlerOptions): Promise<Runtime> {
  const out: Runtime = { shelves: [], roots: [] };
  const wanted = options.shelves;
  const sources = options.sources;
  if (sources?.length) {
    for (const { shelf, api } of sources) {
      if (wanted && !wanted.includes(shelf.id)) continue;
      pushShelf(out, shelf, api);
    }
  } else {
    const { getShelves, getShelf } = await import("zreader/content");
    for (const shelf of await getShelves()) {
      if (wanted && !wanted.includes(shelf.id)) continue;
      pushShelf(out, shelf, getShelf(shelf.id));
    }
  }
  const done = new Set<AgentPlugin>();
  for (const runtime of out.shelves) {
    for (const plugin of runtime.plugins) {
      if (done.has(plugin)) continue;
      done.add(plugin);
      try {
        plugin.setup?.(runtime.shelf);
      } catch (e) {
        throw new Error(`zreader: agent plugin "${plugin.name}" failed setup: ${(e as Error).message}`);
      }
    }
  }
  return out;
}

/**
 * Shelves cannot be nested (§2.3.1), so at most one owns a path. `{basePath}.md`
 * is the shelf's own twin, so it counts as owned too.
 */
function findOwner(runtime: Runtime, pathname: string): ShelfRuntime | undefined {
  return runtime.shelves.find((s) => {
    if (!s.base) return true; // mounted at "/"
    if (pathname === s.base || pathname.startsWith(`${s.base}/`)) return true;
    return pathname === `${s.base}.md`;
  });
}

function acceptedMethods(shelf: ShelfRuntime, pathname: string): AgentPluginMethod[] {
  const set = new Set<AgentPluginMethod>();
  if (matchAgentRoute(pathname, shelf.shelf.basePath)) {
    set.add("GET");
    set.add("HEAD");
  }
  for (const entry of shelf.routes) {
    if (!entry.wildcard && entry.absolute !== pathname) continue;
    for (const m of entry.methods) set.add(m);
  }
  return METHOD_ORDER.filter((m) => set.has(m));
}

// ---------------------------------------------------------------- documents

function notFoundDocument(
  shelf: ShelfRuntime,
  ctx: AgentPluginContext,
  info: NotFoundInfo,
): AgentDocument {
  return {
    kind: "notFound",
    body: `# Not found\n\nNo ${info.what} at \`${info.pathname}\`. See the [shelf](${info.shelfUrl}).\n`,
    meta: { title: "Not found", description: `No ${info.what} at ${info.pathname}.` },
    preamble: [],
    status: 404,
    notFound: info,
  };
}

async function buildDocument(
  shelf: ShelfRuntime,
  ctx: AgentPluginContext,
  match: AgentRouteMatch,
  pathname: string,
): Promise<AgentDocument> {
  const { api } = shelf;
  const url = ctx.url;
  let doc: AgentDocument;

  switch (match.kind) {
    case "shelf": {
      const books = await api.getBooks();
      doc = {
        kind: "shelf",
        body: shelfToMarkdown(books, url, { title: shelf.shelf.title, description: shelf.shelf.description }),
        meta: {
          title: shelf.shelf.title,
          description: shelf.shelf.description,
          canonical: pageUrl(url),
          lastUpdated: newestBookLastUpdated(books),
        },
        preamble: [],
        status: 200,
      };
      break;
    }
    case "book": {
      const book = await api.getBook(match.book);
      if (book) {
        doc = {
          kind: "book",
          body: bookToMarkdown(book, url),
          meta: {
            title: book.title,
            description: book.subtitle ?? book.description,
            canonical: pageUrl(url, book.id),
            lastUpdated: newestLastUpdated(book.chapterEntries),
          },
          preamble: [],
          status: 200,
          book,
        };
      } else {
        doc = notFoundDocument(shelf, ctx, {
          what: "book",
          pathname,
          bookId: match.book,
          books: await api.getBooks(),
          shelf: shelf.shelf,
          shelfUrl: markdownPageUrl(url),
        });
      }
      break;
    }
    case "chapter": {
      const hit = await api.getChapter(match.book, match.chapter);
      if (hit) {
        doc = {
          kind: "chapter",
          body: await chapterToMarkdown(hit, url),
          meta: {
            title: hit.chapter.title,
            description: hit.chapter.description,
            canonical: pageUrl(url, hit.book.id, hit.chapter.id),
            lastUpdated: resolveLastUpdated(hit.chapter),
          },
          preamble: [],
          status: 200,
          book: hit.book,
          chapter: hit,
        };
      } else {
        const book = await api.getBook(match.book);
        doc = notFoundDocument(shelf, ctx, {
          what: book ? "chapter" : "book",
          pathname,
          bookId: match.book,
          ...(book ? { chapterId: match.chapter, book } : {}),
          books: await api.getBooks(),
          shelf: shelf.shelf,
          shelfUrl: markdownPageUrl(url),
        });
      }
      break;
    }
  }

  for (const plugin of shelf.plugins) {
    if (plugin.document) doc = await plugin.document(doc, ctx);
  }
  return doc;
}

// ---------------------------------------------------------------- handler

export function createAgentHandler(options: AgentHandlerOptions = {}): AgentHandler {
  const cacheControl = options.cacheControl ?? DEFAULT_CACHE;
  const devWarnings = options.devWarnings !== false;
  let runtimeP: Promise<Runtime> | undefined;
  const warned = new Set<string>();

  function devWarn(runtime: Runtime, pathname: string, method: string) {
    if (!devWarnings || !isDev()) return;
    const agentish =
      pathname.endsWith(".md") ||
      pathname.endsWith("/llms.txt") ||
      pathname.endsWith("/llms-full.txt") ||
      (method === "POST" && pathname.endsWith("/mcp"));
    if (!agentish) return;
    const head = pathname.split("/").filter(Boolean)[0];
    const base = head ? `/${head}` : "/";
    if (warned.has(base)) return;
    warned.add(base);
    const list = runtime.shelves.map((s) => `${s.shelf.id} → ${s.shelf.basePath}`).join(", ") || "(none)";
    console.warn(
      `[zreader] ${pathname} reached the agent handler, but no bookshelf has basePath "${base}".\n` +
        `          Bookshelves: ${list}.\n` +
        `          Update the matcher in proxy.ts to the new base path.`,
    );
  }

  function context(shelf: ShelfRuntime, request: Request, pathname: string): AgentPluginContext {
    const url: AgentUrlContext = {
      origin: (options.origin ?? requestOrigin(request)).replace(/\/+$/, ""),
      basePath: shelf.shelf.basePath,
    };
    const ctx: AgentPluginContext = {
      shelf: shelf.shelf,
      api: shelf.api,
      url,
      request,
      methods: acceptedMethods(shelf, pathname),
      document(match) {
        return buildDocument(shelf, ctx, match, pathname);
      },
      respond(body, init) {
        const status = init?.status ?? 200;
        const type = init?.type ?? "text/markdown";
        const headers = new Headers({
          "Content-Type": `${type}; charset=utf-8`,
          "Cache-Control": status === 200 ? cacheControl : "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        if (init?.canonical) headers.set("Link", `<${init.canonical}>; rel="canonical"`);
        for (const plugin of shelf.plugins) plugin.headers?.(headers, { ...ctx, status });
        if (devWarnings && isDev()) headers.set("X-Zreader-Shelf", shelf.shelf.id);
        return new Response(request.method === "HEAD" ? null : body, { status, headers });
      },
    };
    return ctx;
  }

  return async (request) => {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method as AgentPluginMethod;
    const runtime = await (runtimeP ??= buildRuntime(options));

    // Root-level routes ("/llms.txt"), claimed by exactly one shelf.
    for (const entry of runtime.roots) {
      if (entry.absolute === pathname && entry.methods.includes(method)) {
        return entry.route.handle(request, context(entry.owner, request, pathname));
      }
    }

    const owner = findOwner(runtime, pathname);
    if (!owner) {
      devWarn(runtime, pathname, method);
      return undefined;
    }

    for (const entry of owner.routes) {
      if (!entry.methods.includes(method)) continue;
      if (!entry.wildcard && entry.absolute !== pathname) continue;
      return entry.route.handle(request, context(owner, request, pathname));
    }

    if (method !== "GET" && method !== "HEAD") return undefined;
    if (options.assets !== false) {
      const asset = await serveAsset(request, {
        basePath: owner.shelf.basePath,
        assets: owner.shelf.content.assets,
        bookDir: async (id) => (await owner.api.getBook(id))?.dir ?? null,
      });
      if (asset) return asset;
    }
    const match = matchAgentRoute(pathname, owner.shelf.basePath);
    if (!match) return undefined;

    const ctx = context(owner, request, pathname);
    const doc = await buildDocument(owner, ctx, match, pathname);
    return ctx.respond(doc.preamble.join("") + doc.body, {
      status: doc.status,
      canonical: doc.meta.canonical,
    });
  };
}
