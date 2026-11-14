/**
 * Types for zreader's agent plugins (`zreader/plugins/agent`).
 *
 * Types only: this module must never import a converter, the content layer or
 * `unified` at runtime, so `reader.config.ts` stays cheap to load inside
 * `next.config`.
 */
import type { BookEntry, ChapterLookup } from "zreader/content";
import type { AgentContentSource, AgentRouteMatch } from "../../agent/handler";
import type { AgentUrlContext } from "../../agent/markdown";
import type { ResolvedShelf } from "../../config/index";

/** Method a plugin route accepts. */
export type AgentPluginMethod = "GET" | "HEAD" | "POST" | "OPTIONS";

/** A route a plugin adds, relative to its shelf's `basePath` (or the site root). */
export interface AgentPluginRoute {
  /** e.g. "/llms.txt". `"*"` matches any path the shelf owns (used by `cors()`). */
  path: string;
  /** Defaults to `["GET", "HEAD"]`. */
  methods?: AgentPluginMethod[];
  handle(request: Request, ctx: AgentPluginContext): Promise<Response> | Response;
}

/** What a plugin's hooks receive: the shelf it is scoped to and the live request. */
export interface AgentPluginContext {
  shelf: ResolvedShelf;
  api: AgentContentSource;
  /** Absolute origin + the shelf's basePath. */
  url: AgentUrlContext;
  request: Request;
  /**
   * Methods the matched path accepts, in a canonical order
   * (`GET, HEAD, POST, OPTIONS`). Used by `cors()` to answer preflights.
   */
  methods?: AgentPluginMethod[];
  /** Build a response with the core headers plus every plugin's `headers` hook. */
  respond(body: string | null, init?: { status?: number; type?: string; canonical?: string }): Response;
  /**
   * Build a core document for this shelf with every plugin's `document` hook
   * applied. A missing book or chapter yields a `notFound` document, so tools
   * (see `mcp()`) return exactly what the `.md` twin would.
   */
  document(match: AgentRouteMatch): Promise<AgentDocument>;
}

/** Title, description, canonical URL and last-updated date of a document (§3.4). */
export interface DocumentMeta {
  title: string;
  description?: string;
  canonical?: string;
  /** ISO date, `YYYY-MM-DD`. */
  lastUpdated?: string;
}

/** Why a request missed: a book, or a chapter inside an existing book. */
export interface NotFoundInfo {
  what: "book" | "chapter";
  pathname: string;
  bookId: string;
  /** Set when `what === "chapter"`. */
  chapterId?: string;
  /** Set when the book exists (`what === "chapter"`). */
  book?: BookEntry;
  /** Every book on this shelf. */
  books: BookEntry[];
  shelf: ResolvedShelf;
  /** The shelf's `.md` URL. */
  shelfUrl: string;
}

/** The document a response is rendered from, before plugins rewrite it. */
export interface AgentDocument {
  kind: "shelf" | "book" | "chapter" | "notFound";
  /** Markdown body, as produced by the converter (or the core 404). */
  body: string;
  /** Core metadata (§3.4). */
  meta: DocumentMeta;
  /** Lines rendered above the body, in order (`frontmatter()` puts its block here). */
  preamble: string[];
  status: number;
  /** Present for book and chapter documents. */
  book?: BookEntry;
  chapter?: ChapterLookup;
  /** Present for notFound documents. */
  notFound?: NotFoundInfo;
}

/**
 * Everything beyond the core `.md` twins is a plugin, scoped to the shelf it is
 * declared on. Factories return a plain descriptor; heavy dependencies are
 * loaded lazily, inside the hooks.
 */
export interface AgentPlugin {
  /** Unique within a shelf; a same-named plugin replaces it when merging. */
  name: string;
  /** Extra routes, relative to the shelf's `basePath` ("/llms.txt", "/mcp"). */
  routes?: AgentPluginRoute[];
  /** Root-level paths this plugin claims, outside any `basePath` ("/llms.txt"). */
  rootRoutes?: AgentPluginRoute[];
  /** Rewrite a core document before it is rendered. Runs in plugin order. */
  document?(doc: AgentDocument, ctx: AgentPluginContext): AgentDocument | Promise<AgentDocument>;
  /** Adjust headers on every response this shelf produces (core and plugin routes). */
  headers?(headers: Headers, ctx: AgentPluginContext & { status: number }): void;
  /** Called once per process per shelf when the handler resolves the shelf. */
  setup?(shelf: ResolvedShelf): void;
  /** @internal Set by `disable()`: the plugin name to remove after merging. */
  disable?: string;
}
