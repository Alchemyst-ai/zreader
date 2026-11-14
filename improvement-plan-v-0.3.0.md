# zreader 0.3.0 — bookshelves and agent plugins

Plan for the next release of zreader's agent layer, informed by comparing
`zreader/agent` with the hand-rolled Markdown layer in Alchemyst Press
(`apps/web/lib/agent/markdown.ts`).

The release does two things:

1. **Bookshelves.** `defineConfig({ bookshelves: [...] })` declares one or more
   shelves, each with its own content folder, `basePath` and agent plugins. Every
   zreader surface — the agent handler, `ReaderRoot`, `ReaderChapter`, the static
   params helpers, `withReader` tracing — reads shelves from the same config.
2. **Agent plugins.** Everything beyond the core `.md` twins becomes an opt-in
   plugin, scoped to the shelf it is declared on:

| Plugin | Adds |
| --- | --- |
| `frontmatter()` | YAML frontmatter (`title`, `description`, `canonical`, `last_updated`, …) on every document |
| `llmsTxt({ full })` | `{basePath}/llms.txt`, and with `full`, `{basePath}/llms-full.txt` — this shelf's books only |
| `notFound()` | A 404 document that lists the valid book and chapter ids |
| `cors()` | `Access-Control-Allow-Origin`, `Vary`, and `OPTIONS` preflights |
| `mcp()` | A stateless MCP server at `POST {basePath}/mcp` |

Plus a **development warning** when a shelf's routes are not reaching zreader
(stale proxy matcher, renamed app folder).

Target release: **0.3.0**. This is a `0.x` release with deliberate breaking
changes, listed in [§11](#11-breaking-changes).

---

## Contents

1. [Design principles](#1-design-principles)
2. [Bookshelves in `defineConfig`](#2-bookshelves-in-defineconfig)
3. [The core agent handler](#3-the-core-agent-handler)
4. [The plugin interface](#4-the-plugin-interface)
5. [`frontmatter()`](#5-frontmatter)
6. [`llmsTxt({ full })`](#6-llmstxt-full-)
7. [`notFound()`](#7-notfound)
8. [`cors()`](#8-cors)
9. [`mcp()`](#9-mcp)
10. [Development warnings](#10-development-warnings)
11. [Breaking changes](#11-breaking-changes)
12. [Implementation steps](#12-implementation-steps)
13. [Verification](#13-verification)
14. [Not in this release](#14-not-in-this-release)
15. [Press-side follow-up](#15-press-side-follow-up)

---

## 1. Design principles

1. **A shelf is the unit of scope.** Each shelf owns one route (`/books`,
   `/reports`, …) and everything under it; shelves are never nested (§2.3.1).
   Every agent document, index and tool covers exactly one shelf's books.
   Nothing reaches across shelves except the optional root `/llms.txt`, which
   one shelf must explicitly claim.
2. **One declaration, read everywhere.** Shelves and plugins live in
   `reader.config.ts`. The proxy handler cannot read React props, so the config
   is the only place both the HTTP layer and the React layer can see.
3. **The core is small; everything else is a plugin.** The core handler serves
   the `.md` twins (shelf, book, chapter) and a one-line 404. Frontmatter,
   `llms.txt`, the rich 404, CORS and MCP are plugins, all opt-in.
4. **Converters stay pure.** `chapterToMarkdown()`, `bookToMarkdown()` and
   friends keep returning plain Markdown. Plugins decorate the handler's output;
   a consumer calling a converter directly still gets a clean document.
5. **The content layer is the only data source.** Every plugin reads through
   `AgentContentSource`, so custom sources keep working.
6. **The config must stay light.** `withReader` loads `reader.config.ts` with
   jiti inside `next.config`. Plugin factories return plain descriptors and load
   their heavy dependencies (`unified`, remark) lazily, on first request.

---

## 2. Bookshelves in `defineConfig`

### 2.1 Shape

```ts
// reader.config.ts
import { defineConfig, glob } from "zreader/config";
import { cors, frontmatter, llmsTxt, mcp, notFound } from "zreader/plugins/agent";

export default defineConfig({
  // Shared defaults, inherited by every shelf.
  content: { remarkPlugins: [], sanitize: { allowIframes: ["youtube.com"] } },
  reader: { defaultTheme: "sepia" },
  agent: { plugins: [frontmatter(), notFound()] },

  bookshelves: [
    {
      id: "books",
      basePath: "/books",
      content: { loader: glob({ base: "./content/books" }) },
      agent: { plugins: [llmsTxt({ full: true, root: true }), cors()] },
    },
    {
      id: "reports",
      basePath: "/reports",
      title: "Quarterly reports",
      content: { loader: glob({ base: "./content/reports" }) },
      agent: { plugins: [llmsTxt(), mcp()] },
    },
  ],
});
```

```ts
export interface BookshelfConfig {
  /** Stable id, used by `ReaderRoot shelf="…"`, `getShelf("…")` and storage keys. */
  id: string;
  /** Where the shelf is mounted. Must start with "/"; "/" is allowed. */
  basePath: string;
  /** Shelf title (shelf `.md` H1, `llms.txt` H1, frontmatter). Defaults to "Books". */
  title?: string;
  /** Shelf summary (shelf `.md`, `llms.txt`, frontmatter). */
  description?: string;
  /** Merged over the top-level `content`. */
  content?: ReaderUserConfig["content"];
  /** Merged over the top-level `reader` (client options), minus `basePath`. */
  reader?: Omit<DeepPartial<ReaderClientOptions>, "basePath">;
  /** Plugins for this shelf; merged with the top-level `agent.plugins` (§2.4). */
  agent?: { plugins?: AgentPlugin[] };
}

export interface ReaderUserConfig {
  content?: …;                         // unchanged; now the shared default
  reader?: DeepPartial<ReaderClientOptions>;
  agent?: { plugins?: AgentPlugin[] }; // new; server-only, never sent to the client
  bookshelves?: BookshelfConfig[];     // new
}

export interface ResolvedShelf {
  id: string;
  basePath: string;
  title: string;
  description?: string;
  content: ContentConfig;
  reader: ReaderClientOptions;   // basePath filled in from the shelf
  plugins: AgentPlugin[];
}

export interface ResolvedReaderConfig {
  root: string;
  content: ContentConfig;        // the default shelf's
  reader: ReaderClientOptions;   // the default shelf's
  shelves: ResolvedShelf[];      // new; never empty
  defaultShelf: string;          // new; id of the first shelf
}
```

### 2.2 The implicit shelf

When `bookshelves` is absent, zreader creates one shelf from the top-level keys:

```ts
{ id: "books", basePath: reader.basePath, content, reader, plugins: agent.plugins }
```

So an existing `reader.config.ts` resolves to exactly one shelf with the same
folder and base path as today. `reader.basePath` stays valid in this mode.

When `bookshelves` is present, `reader.basePath` at the top level is an error
(`reader.basePath: set basePath on each bookshelf instead`), so there is never
any doubt which base path wins.

The **default shelf** is the first one in the array. It is what the existing
module-level functions (`getBooks()`, `getChapter()`, …) and a bare
`<ReaderRoot>` use, so single-shelf code keeps working unchanged.

### 2.3 Validation (at `next dev` / `next build` start, via `setupReader`)

| Rule | Error |
| --- | --- |
| `id` matches `/^[a-z0-9][a-z0-9_-]*$/i` | `bookshelves[1].id: use letters, digits, '-' or '_'` |
| `id`s are unique | `bookshelves[1].id: duplicate id "books"` |
| `basePath` starts with `/` | as today |
| `basePath`s are unique after trimming trailing slashes | `bookshelves[1].basePath: "/books" is already used by "books"` |
| **Shelves cannot be nested**: no `basePath` may sit inside another (§2.3.1) | `bookshelves[1].basePath: "/books/shelf1" is inside "/books" (bookshelf "books"); bookshelves cannot be nested` |
| `basePath: "/"` only when it is the sole shelf | `bookshelves[1].basePath: "/" would contain every other bookshelf; bookshelves cannot be nested` |
| At most one shelf has `llmsTxt({ root: true })` | `… /llms.txt is already claimed by "books"` |
| Each plugin is an object with a string `name` | `bookshelves[0].agent.plugins[2]: not a zreader agent plugin` |
| Within one shelf, plugin `name`s are unique after merging | `… two "llmsTxt" plugins` |
| Each `content.loader.base` exists (warning, not error) | `[zreader] bookshelf "reports": ./content/reports does not exist` |

Rules that need plugins (the `root: true` check) are evaluated on the resolved
plugin list, so they also catch a root `llms.txt` inherited from the top level.

#### 2.3.1 One route per shelf, never nested

Each bookshelf owns exactly one route and everything under it: `/books` is one
shelf, `/reports` is another. A shelf's `basePath` may not be inside another
shelf's, so if `/books` exists, `/books/shelf1` cannot.

| Shelves | Allowed? | Why |
| --- | --- | --- |
| `/books`, `/reports` | Yes | Siblings |
| `/books`, `/bookstore` | Yes | Compared by path segment, not by string prefix |
| `/docs/books`, `/docs/reports` | Yes | Siblings under a path zreader doesn't own |
| `/books`, `/books/shelf1` | No | `/books/shelf1` is inside `/books` |
| `/docs`, `/docs/books` | No | Same, one level deeper |
| `/`, `/books` | No | `/` contains every path |

The check normalises each `basePath` (trailing slashes trimmed, `//` collapsed)
and rejects a pair when one, followed by `/`, is a prefix of the other.

Why it is a hard rule:

- **Routing is unambiguous.** Under `/books`, the first segment is always a
  book id (`/books/:book`, `/books/:book/:chapter`). A nested `/books/shelf1`
  would be indistinguishable from a book called `shelf1`, in the agent handler,
  in the Next.js `app/` folder and in `hrefFor` links.
- **Scope stays clean.** "This shelf's books only" (§1, principle 1) would be
  ambiguous for `/books/llms.txt` if another shelf lived under `/books`.
- **The handler is simple.** A path belongs to at most one shelf, so lookup is
  a single segment match with no longest-prefix rules.

A site that wants grouping (e.g. "archived books") uses a sibling shelf
(`/archive`) or a `part` within a book, not a nested shelf.

### 2.4 Merging

- **`content`:** `mergeConfig(defaults, top-level content, shelf content)` —
  the existing deep merge (arrays and schemas replace).
- **`reader`:** `mergeConfig(DEFAULT_CLIENT_OPTIONS, top-level reader, shelf reader)`,
  then `basePath` is set from the shelf.
- **`agent.plugins`:** top-level plugins first, then the shelf's. A shelf plugin
  with the same `name` **replaces** the inherited one in place, so its position
  (and therefore its run order) is kept. To drop an inherited plugin, a shelf
  lists `disable("notFound")` — a tiny built-in plugin that removes a name.

### 2.5 Storage keys

Highlights, notes and progress are keyed by `storagePrefix` + book id. Two
shelves can contain books with the same id, so:

- The **default shelf** keeps `reader.storagePrefix` (`"zr"`) unchanged, so
  existing readers keep their data.
- **Every other shelf** defaults to `${storagePrefix}-${shelf.id}` (e.g.
  `zr-reports`) unless it sets `reader.storagePrefix` itself.

### 2.6 Content API

```ts
// zreader/content
export function getShelf(id?: string): ShelfApi;   // default shelf when omitted
export function getShelves(): Promise<ResolvedShelf[]>;

// ShelfApi = today's createApi() result + the shelf itself
export interface ShelfApi extends AgentContentSource {
  shelf(): Promise<ResolvedShelf>;
  getBookMetas(): Promise<BookMeta[]>;
  renderChapter(entry: ChapterEntry): Promise<RenderedChapter>;
  getStaticParams<B, C>(names?): Promise<Array<Record<B | C, string>>>;
}
```

`getBooks`, `getBook`, `getChapter`, … at module level become
`getShelf().getBooks`, etc. Book caches are per shelf (the `WeakMap` in
`src/content/index.ts:31` is keyed on the shelf's resolved content config
instead of the whole config).

`defineBooks()` stays as an escape hatch for content that is not a shelf (e.g.
a one-off loader in a script). It gains no plugins and is not traced by
`withReader`; the docs point at `bookshelves` for anything served.

### 2.7 Next.js integration

**`withReader`** traces every shelf's `content.loader.base` into
`outputFileTracingIncludes` for `/**`, `proxy` and `middleware`
(today it traces only the single content folder, `src/next/index.ts:65-73`).

**`ReaderRoot`** and **`ReaderChapter`** gain a `shelf` prop:

```tsx
// app/reports/layout.tsx
export default function Layout({ children }) {
  return <ReaderRoot shelf="reports" agent>{children}</ReaderRoot>;
}

// app/reports/[book]/[chapter]/page.tsx
export default async function Page({ params }) {
  return <ReaderChapter shelf="reports" {...await params} />;
}
export const generateStaticParams = () => getChapterParams("reports");
```

- `ReaderRoot shelf` loads that shelf's books and passes that shelf's resolved
  `reader` options (including its `basePath` and `storagePrefix`) to the
  provider. Omitted, it uses the default shelf — today's behaviour.
- `ReaderChapter shelf` loads and renders through `getShelf(shelf)`. Today it is
  hard-wired to the global API (`src/next/server/index.tsx:101-104`), which is
  the single biggest blocker for more than one shelf.
- `getBookParams(shelf?)` and `getChapterParams(shelf?)` take the shelf id.

The client never receives plugins or content config: `ReaderRoot` passes only
`shelf.reader` (plain JSON) to `NextReaderProvider`, exactly as it passes
`config.reader` today.

---

## 3. The core agent handler

### 3.1 Routes

For each shelf, relative to its `basePath`:

| Path | Document |
| --- | --- |
| `{basePath}.md` (`/index.md` when `basePath` is `/`) | The shelf |
| `{basePath}/:book.md` | A book's table of contents |
| `{basePath}/:book/:chapter.md` | A chapter |

Plugins add more (§4). The root `/llms.txt` is no longer a core route.

### 3.2 API

```ts
export interface AgentHandlerOptions {
  /** Shelf ids to serve. Defaults to every shelf in reader.config.ts. */
  shelves?: string[];
  /** Absolute origin for links. Defaults to the request's forwarded host. */
  origin?: string;
  /** Cache-Control for successful responses. */
  cacheControl?: string;
  /** Silence the development warnings (§10). */
  devWarnings?: boolean;
  /** Advanced: serve a custom content source as a shelf (tests, non-file content). */
  sources?: Array<{ shelf: ResolvedShelf; api: AgentContentSource }>;
}

export function createAgentHandler(options?: AgentHandlerOptions): AgentHandler;
```

`createAgentHandler()` with no arguments now serves **every** shelf. Because
shelves cannot be nested (§2.3.1), a path belongs to at most one shelf; lookup
compares the path's leading segments against each `basePath` and needs no
precedence rules.

### 3.3 Response pipeline

For each request:

1. Reject anything other than the methods some route accepts (`GET`, `HEAD` for
   the core; plugins may add `POST`, `OPTIONS`). Otherwise return `undefined`.
2. Find the shelf whose `basePath` owns the path, or the shelf that claimed
   root `/llms.txt`. None → `undefined` (plus the dev warning in §10.1).
3. Match the shelf's plugin routes, in plugin order. A match → the plugin's
   `handle()` produces the response; go to step 6.
4. Match the core routes. No match → `undefined`.
5. Build an `AgentDocument` (§4.2) for the shelf, book or chapter, or a
   `notFound` document. Run every plugin's `document` hook in order, then
   render.
6. Apply headers: the core set (`Content-Type`, `Cache-Control`,
   `X-Content-Type-Options`, `Link: rel="canonical"`), then every plugin's
   `headers` hook in order. In development, also `X-Zreader-Shelf: <id>` (§10.2).
7. `HEAD` → the same headers, no body.

### 3.4 Core metadata

The core computes these for every document, whether or not any plugin uses
them, so plugins never re-derive them:

| Document | `title` | `description` | `canonical` | `lastUpdated` |
| --- | --- | --- | --- | --- |
| Shelf | `shelf.title` | `shelf.description` | `pageUrl(ctx)` | newest across all books |
| Book | `book.title` | `book.subtitle ?? book.description` | `pageUrl(ctx, book.id)` | newest across `book.chapterEntries` |
| Chapter | `chapter.title` | `chapter.description` (no fallback to the book's) | `pageUrl(ctx, book.id, chapter.id)` | the chapter's (§5.4) |
| Not found | `"Not found"` | `No {what} at {pathname}.` | — | — |

`lastUpdated` for books and the shelf reads `chapterEntries`, not `chapters`:
`ChapterMeta` has no `mtimeMs` or `data` (`src/core/types.ts:123`); only
`ChapterEntry` does (`src/content/loader.ts:11-20`).

### 3.5 The core 404

Without `notFound()`, a miss under a shelf's base path returns today's
one-line document (`src/agent/handler.ts:121-122`), with HTTP 404 and
`Cache-Control: no-store`. It only applies to paths the shelf owns; anything
else returns `undefined`.

### 3.6 `matchAgentRoute`

```ts
export type AgentRouteMatch =
  | { kind: "shelf" }
  | { kind: "book"; book: string }
  | { kind: "chapter"; book: string; chapter: string };

export function matchAgentRoute(pathname: string, basePath: string): AgentRouteMatch | null;
```

The `llms` parameter and `{ kind: "llms" }` are removed (that route belongs to
the plugin). The return type is now exported as `AgentRouteMatch`.

---

## 4. The plugin interface

### 4.1 Types

Exported from `zreader/plugins/agent`:

```ts
export interface AgentPlugin {
  /** Unique within a shelf; same-name plugins replace each other when merging. */
  name: string;
  /** Extra routes, relative to the shelf's basePath ("/llms.txt", "/mcp"). */
  routes?: AgentPluginRoute[];
  /** Root-level paths this plugin claims, outside any basePath ("/llms.txt"). */
  rootRoutes?: AgentPluginRoute[];
  /** Rewrite a core document before it is rendered. Runs in plugin order. */
  document?(doc: AgentDocument, ctx: AgentPluginContext): AgentDocument | Promise<AgentDocument>;
  /** Adjust headers on every response this shelf produces (core and plugin routes). */
  headers?(headers: Headers, ctx: AgentPluginContext & { status: number }): void;
  /** Called once per process when the handler is created; validate options here. */
  setup?(shelf: ResolvedShelf): void;
}

export interface AgentPluginRoute {
  path: string;
  /** Defaults to ["GET", "HEAD"]. */
  methods?: Array<"GET" | "HEAD" | "POST" | "OPTIONS">;
  handle(request: Request, ctx: AgentPluginContext): Promise<Response> | Response;
}

export interface AgentPluginContext {
  shelf: ResolvedShelf;
  api: AgentContentSource;
  url: AgentUrlContext;     // { origin, basePath }
  request: Request;
  /** Build a response with the core headers + every plugin's headers hook. */
  respond(body: string | null, init?: { status?: number; type?: string; canonical?: string }): Response;
}
```

Plugin routes respond through `ctx.respond()` so that `cors()` and the other
`headers` hooks apply to them too.

### 4.2 `AgentDocument`

```ts
export interface AgentDocument {
  kind: "shelf" | "book" | "chapter" | "notFound";
  /** Markdown body, as produced by the converter (or the core 404). */
  body: string;
  /** Core metadata (§3.4). */
  meta: DocumentMeta;
  /** Lines rendered above the body, in order (frontmatter puts its block here). */
  preamble: string[];
  status: number;
  /** Present for book and chapter documents. */
  book?: BookEntry;
  chapter?: ChapterLookup;
  /** Present for notFound documents. */
  notFound?: NotFoundInfo;
}

export interface DocumentMeta {
  title: string;
  description?: string;
  canonical?: string;
  /** ISO date, YYYY-MM-DD. */
  lastUpdated?: string;
}
```

The rendered response is `preamble.join("") + body`. Plugins do not
concatenate onto `body` directly, so a frontmatter block always comes first
regardless of plugin order.

### 4.3 Where plugins live: `zreader/plugins/*`

Plugins get their own namespace, separate from the feature they extend:

| Subpath | Contents |
| --- | --- |
| `zreader/plugins/agent` | `frontmatter`, `llmsTxt`, `notFound`, `cors`, `mcp`, `disable`, and the `AgentPlugin` types (this release) |
| `zreader/plugins/*` | Reserved for future plugin families (e.g. reader UI or content-pipeline plugins), each in its own subpath |

Source lives in `src/plugins/agent/`, beside `src/agent/` rather than inside
it. `zreader/agent` keeps the handler and converters; `zreader/plugins/agent`
holds only the plugin factories and types, and depends on `zreader/agent`
(never the other way round).

`zreader/plugins/agent` is a **new export subpath**. Factories return
descriptors immediately and `import()` `zreader/agent`'s converters (and with
them `unified`) inside their hooks. This keeps `reader.config.ts` cheap to load
in `next.config`.

There is no import cycle: `zreader/agent` imports only *types* from
`zreader/content` and loads the default API with a dynamic `import()`
(`src/agent/handler.ts:85-93`), and the handler imports only the plugin
*types*. A test (§12, step 9) fails if `zreader/plugins/agent` ever gains a
static import of `unified`, `zreader/content` or `zreader/virtual-config`.

### 4.4 Writing your own

```ts
const robots = (): AgentPlugin => ({
  name: "robots",
  headers(h) { h.set("X-Robots-Tag", "noindex"); },
});
```

---

## 5. `frontmatter()`

### 5.1 Output

```md
---
title: "Why context is the product — Context Field Notes"
description: "Models are interchangeable. What you feed them is not."
canonical: "https://press.example.com/books/context-field-notes/why-context"
last_updated: "2026-11-02"
book: "Context Field Notes"
label: "Part I"
---

# Why context is the product
…
```

Applied to shelf, book, chapter and 404 documents. Not applied to `llms.txt`,
`llms-full.txt` or MCP responses.

### 5.2 Options

```ts
export interface FrontmatterOptions {
  /** Document title. Default: chapter → "Chapter — Book"; book → book title; shelf → shelf title. */
  title?: (doc: AgentDocument) => string;
  /** Override how lastUpdated is found (§5.4). */
  lastUpdated?: (entry: ChapterEntry) => string | Date | number | undefined;
  /** Extra fields, appended after the standard ones in insertion order. */
  extra?: (doc: AgentDocument) => Record<string, string | undefined> | undefined;
}

export function frontmatter(opts?: FrontmatterOptions): AgentPlugin;
```

Default extra fields: chapters get `book` (the book title) and `label` (when
set). Books and the shelf get none.

### 5.3 Rendering rules

Exported for direct use as `renderFrontmatter(fields)` from `zreader/agent`
(named so it doesn't clash with the plugin factory, or with "frontmatter" as
zreader already uses it for chapter source metadata):

- Field order: `title`, `description`, `canonical`, `last_updated`, then extras.
- Every value is a JSON string (`JSON.stringify`), which is a valid YAML
  double-quoted scalar. Whitespace runs collapse to a single space first.
- `undefined` and empty-string values are omitted.
- Extra keys must match `/^[A-Za-z_][\w-]*$/`; anything else throws at
  `setup()` time (for static keys) or is dropped with a dev warning (for keys
  computed per document).
- Returns `""` when there are no fields; otherwise `---\n…\n---\n\n`.
- 404 documents get `title` and `description`, never `canonical`.

### 5.4 `last_updated`

Resolved per chapter, first hit wins:

1. `opts.lastUpdated(entry)`, if given.
2. The chapter's own frontmatter: `data.updated`, `data.lastUpdated`,
   `data.last_updated`, `data.date` (string, `Date` or number).
3. `entry.mtimeMs`.

Formatted as `YYYY-MM-DD` in UTC. Invalid dates are skipped, not emitted.
A book's value is the newest across its chapters; the shelf's is the newest
across its books.

The docs must say plainly: **on CI and most hosts, `mtimeMs` is the checkout
time**, because `git clone` does not preserve modification times. For dates
that are stable across deploys, set `updated:` in chapter frontmatter or pass
`lastUpdated` (e.g. reading `git log -1 --format=%cs` at build time).

---

## 6. `llmsTxt({ full })`

### 6.1 Options

```ts
export interface LlmsTxtPluginOptions {
  /** Also serve {basePath}/llms-full.txt. Default false. */
  full?: boolean;
  /** Also serve /llms.txt (and /llms-full.txt with `full`) at the site root. One shelf only. */
  root?: boolean;
  /** H1. Defaults to the shelf title (or the book title for a one-book shelf). */
  title?: string;
  /** Summary line. Defaults to the shelf description. */
  description?: string;
}

export function llmsTxt(opts?: LlmsTxtPluginOptions): AgentPlugin;
```

### 6.2 Routes

| Path | Type | Content |
| --- | --- | --- |
| `{basePath}/llms.txt` | `text/plain` | Today's `llmsTxt()` index, for this shelf's books only |
| `{basePath}/llms-full.txt` | `text/markdown` | Every chapter of this shelf, concatenated (§6.3) |
| `/llms.txt`, `/llms-full.txt` | as above | With `root: true`: the same documents, for this shelf only |

For `basePath: "/"`, `{basePath}/llms.txt` *is* `/llms.txt`; `root` is then
implied.

`root: true` serves only the claiming shelf's books. A site-wide index across
shelves is a link list a site can write itself; zreader does not merge shelves.

### 6.3 `llms-full.txt` structure

```md
# Quarterly reports — full text

> Every book and chapter in this shelf, concatenated for agents.

## Q3 2026

Source: https://example.com/reports/q3-2026

Results and commentary for the third quarter.

### Revenue

Source: https://example.com/reports/q3-2026/revenue

The chapter body, headings demoted by two…
```

Rules:

- H1 for the document, H2 per book, H3 per chapter, so chapter content starts
  at H4.
- **If the chapter body has its own H1** (`hasH1`, `src/agent/markdown.ts:169`),
  the synthetic `### title` is not emitted. The body's headings are demoted by
  **2**, so its H1 becomes the chapter's H3.
- **If it doesn't**, `### {chapter.title}` is emitted and the body's headings
  are also demoted by 2 (its H2 becomes H4).
- Depth is clamped at 6.
- Demotion is on the mdast (`remark-parse` → shift `heading.depth` →
  `remark-stringify`), so `#` lines inside fenced code are untouched.
- Chapter bodies come from `chapterBodyToMarkdown()`, so MDX is cleaned and
  HTML is converted exactly as in the single-chapter twin.

(Press's `.replace(/^(#{1,4}) /gm, "$1## ")` also demotes by two; this keeps
that depth while fixing the fenced-code case.)

### 6.4 API

```ts
// zreader/agent
export function fullTextToMarkdown(books: BookEntry[], ctx: AgentUrlContext, opts?: { title?: string; description?: string }): Promise<string>;
export function demoteHeadings(markdown: string, by: number): Promise<string>;
```

`books` is `BookEntry[]`, not `BookMeta[]`: the bodies live in
`chapterEntries`.

### 6.5 Caching and cost

- The assembled document is memoised per shelf, keyed on every chapter's
  `file` and `mtimeMs` (the same key `chapterBodyToMarkdown` uses). Unchanged
  content is concatenated once per process.
- `HEAD` returns headers without building the document (the length is not
  sent).
- `chapterBodyToMarkdown`'s cache holds 500 entries
  (`src/agent/markdown.ts:192`). A shelf larger than that would thrash it when
  building the full text, so the full-text builder bypasses that cache and
  relies on its own memo.
- The response uses the handler's `cacheControl`. The docs note it can be
  large and should be CDN-cached; a separate cache control per route is out of
  scope.

---

## 7. `notFound()`

### 7.1 Output

For `/books/context-field-notes/nope.md`:

```md
# Not found

No chapter `nope` in [Context Field Notes](https://press.example.com/books/context-field-notes.md).

## Chapters in Context Field Notes

- [Why context is the product](https://press.example.com/books/context-field-notes/why-context.md)
- [Retrieval is a product decision](https://press.example.com/books/context-field-notes/retrieval.md)

## All books

- [Context Field Notes](https://press.example.com/books/context-field-notes.md) — 12 chapters
- [Agents in Production](https://press.example.com/books/agents-in-production.md) — 8 chapters

See the [shelf](https://press.example.com/books.md).
```

- When the **book** is missing: no "Chapters in" section.
- When the book exists but the **chapter** is missing: both sections.
- Lists are capped (`maxBooks`, default 50; `maxChapters`, default 100). Past
  the cap: `- …and 12 more; see the [index](…/llms.txt)` (or the shelf `.md`
  when `llmsTxt` is not enabled).
- Only this shelf's books are listed.

HTTP 404, `Cache-Control: no-store`, `text/markdown`. Frontmatter is added by
`frontmatter()` when that plugin is also enabled.

### 7.2 Options

```ts
export interface NotFoundOptions {
  /** H1. Default "Not found". */
  title?: string;
  maxBooks?: number;
  maxChapters?: number;
  /** Replace the body entirely. */
  render?: (info: NotFoundInfo) => string | Promise<string>;
}

export interface NotFoundInfo {
  what: "book" | "chapter";
  pathname: string;
  bookId: string;
  /** Set when what === "chapter". */
  chapterId?: string;
  /** Set when the book exists (what === "chapter"). */
  book?: BookEntry;
  books: BookEntry[];
  shelf: ResolvedShelf;
  shelfUrl: string;
}

export function notFound(opts?: NotFoundOptions): AgentPlugin;
// zreader/agent
export function notFoundToMarkdown(info: NotFoundInfo, ctx: AgentUrlContext, opts?: NotFoundOptions): string;
```

Implemented as a `document` hook on `kind: "notFound"` documents, so it only
runs for paths the shelf owns.

---

## 8. `cors()`

```ts
export interface CorsOptions {
  /** Access-Control-Allow-Origin. Default "*". */
  origin?: string;
  /** Vary values, joined with ", ". Default none. */
  vary?: string | string[];
  /** Access-Control-Max-Age for preflights. Default 86400. */
  maxAge?: number;
}

export function cors(opts?: CorsOptions): AgentPlugin;
```

- Sets `Access-Control-Allow-Origin` (and `Vary` when given) on every response
  the shelf produces: twins, 404s, `llms*.txt`, MCP.
- Answers `OPTIONS` on every route of the shelf with a 204, allowing the
  methods that route accepts, `Content-Type`, `Mcp-Session-Id` and
  `Mcp-Protocol-Version`.
- With a non-`*` `origin`, also adds `Origin` to `Vary`.
- `vary` is there for sites that negotiate on `Accept` or `User-Agent` in their
  own proxy. zreader itself does not, so it adds no `Vary` by default; adding it
  for headers that never vary only fragments caches.

Why opt-in: the documents are public, but the `CopyReference` flow does not
need CORS (it opens `chatgpt.com/?q=…` and the assistant fetches server-side,
`src/agent/react/reference.ts:18`). CORS matters for browser-side agents,
extensions and browser MCP clients, which a site enables deliberately.

---

## 9. `mcp()`

### 9.1 Transport

A stateless MCP server over the Streamable HTTP transport, at
`POST {basePath}/mcp`:

- JSON-RPC 2.0 over `POST`; every response is `application/json` (no SSE
  stream, no sessions, no server-initiated messages).
- `GET` and `DELETE` are **not** handled, so they fall through to the app. A
  book with the id `mcp` keeps its HTML page at `GET /reports/mcp`.
- Methods: `initialize`, `notifications/initialized` (202, no body), `ping`,
  `tools/list`, `tools/call`. Anything else → JSON-RPC `-32601`.
- Batched requests are supported. Malformed JSON → `-32700`.
- Hand-rolled, no dependency on `@modelcontextprotocol/sdk`. The trade-off is
  that spec changes are tracked by hand; the protocol version is a constant in
  one place, and the docs state which version is implemented.

### 9.2 Tools

| Tool | Input | Output |
| --- | --- | --- |
| `list_books` | — | `[{ id, title, subtitle, authors, description, chapters: [{ id, title, label, description }] }]` |
| `get_book` | `{ book }` | The book `.md` document (with plugin `document` hooks applied) |
| `get_chapter` | `{ book, chapter }` | The chapter `.md` document (with plugin `document` hooks applied) |
| `search` | `{ query, book?, limit? = 10 }` | `[{ book, chapter, title, url, snippet, score }]` |

Unknown ids return a tool result with `isError: true` and the `notFound()`
text when that plugin is on.

### 9.3 Options

```ts
export interface McpOptions {
  /** Route, relative to basePath. Default "/mcp". */
  path?: string;
  /** Server name in `initialize`. Default `zreader-${shelf.id}`. */
  name?: string;
  /** Replace the default search. */
  search?: (query: string, books: BookEntry[], opts: { book?: string; limit: number }) => Promise<SearchHit[]> | SearchHit[];
  /** Disable individual tools. */
  tools?: Partial<Record<"list_books" | "get_book" | "get_chapter" | "search", boolean>>;
}

export function mcp(opts?: McpOptions): AgentPlugin;
```

### 9.4 Default search

An in-memory index built lazily per shelf from `chapterBodyToMarkdown()`
output, memoised on the same `file`/`mtimeMs` key as §6.5:

- Lower-cased, diacritic-folded terms; title matches weigh more than body.
- Scored with BM25 over chapters; a snippet is the ~200 characters around the
  first match.
- Good enough for a shelf of hundreds of chapters. Anything larger passes
  `search`.

### 9.5 Security

Read-only tools over public content; no auth. The docs say so, and point at
the app's own proxy for rate limiting or auth if a site needs it.

---

## 10. Development warnings

All are `NODE_ENV === "development"` only, `console.warn` with a `[zreader]`
prefix, fire **once per process per shelf**, and are silenced with
`createAgentHandler({ devWarnings: false })` (handler) or
`<ReaderRoot devWarnings={false}>` (React).

### 10.1 A request reached the handler, but no shelf owns it

The handler sees `/books/intro.md` (or `/books/llms.txt`, `/books/mcp`) and no
shelf has `basePath: "/books"`. This is what a stale matcher looks like after
`basePath` was renamed from `/books` to `/read`:

```
[zreader] /books/intro.md reached the agent handler, but no bookshelf has basePath "/books".
          Bookshelves: books → /read, reports → /reports.
          Update the matcher in proxy.ts to the new base path.
```

Triggered only for paths that look like agent routes (end in `.md`,
`/llms.txt`, `/llms-full.txt`, or are a `POST` to `…/mcp`).

### 10.2 `ReaderRoot` advertises twins the proxy doesn't serve

`<ReaderRoot agent>` adds a `<link rel="alternate" type="text/markdown">` and a
Copy Reference button pointing at `.md` twins. If the proxy matcher does not
cover the shelf's base path, those links 404.

In development, the first time `ReaderRoot` renders for a shelf it fires a
background `HEAD {origin}{basePath}.md` (origin from `next/headers`; never
awaited, never blocks rendering). In development the handler stamps every
response with `X-Zreader-Shelf: <id>`. If the probe's response lacks that
header:

```
[zreader] <ReaderRoot shelf="reports" agent> links to /reports/*.md, but /reports.md
          is not served by createAgentHandler(). Add these to the matcher in proxy.ts:
            "/reports.md", "/reports/:path*.md", "/reports/llms.txt", "/reports/mcp"
```

The suggested matcher lists only the routes that shelf's plugins actually
enable.

### 10.3 The reader is mounted outside its base path

Client-side, in `ReaderProvider`: if `window.location.pathname` is not under
the provider's `basePath`, every `hrefFor` link is wrong. This is what a
renamed `basePath` without a renamed `app/` folder looks like:

```
[zreader] This reader's basePath is "/read", but it is mounted at /books/intro.
          Rename app/books/ to app/read/, or set basePath back to "/books".
```

### 10.4 The matcher in the docs

The docs recommend a **literal matcher per shelf**. Next.js requires
`config.matcher` to be a static literal, so zreader cannot generate it from
the config; §10.1 and §10.2 catch the drift instead.

```ts
export const config = {
  matcher: [
    "/books.md", "/books/:path*.md", "/books/llms.txt", "/books/llms-full.txt",
    "/reports.md", "/reports/:path*.md", "/reports/llms.txt", "/reports/mcp",
    "/llms.txt", "/llms-full.txt",
  ],
};
```

The docs also describe the alternative: a broad matcher
(`"/((?!_next/|favicon.ico).*)"`) with the handler returning `undefined` for
anything it doesn't own. It never goes stale, at the cost of running the proxy
on every request.

---

## 11. Breaking changes

`0.x`, so these ship in a minor. Each gets a "Migrating to 0.3" entry in the
changelog.

| # | Change | Migration |
| --- | --- | --- |
| 1 | `/llms.txt` is no longer served by default | Add `llmsTxt({ root: true })` to `agent.plugins` |
| 2 | The `llms` option of `createAgentHandler` is removed | Use the `llmsTxt()` plugin's options |
| 3 | `createAgentHandler({ api, basePath })` is removed | Declare a bookshelf; for non-file content use `sources` |
| 4 | `createAgentHandler()` serves every shelf, not just the default content | No change for single-shelf apps |
| 5 | `matchAgentRoute(pathname, basePath, llms)` loses `llms`; `{ kind: "llms" }` is gone | Drop the third argument |
| 6 | `reader.basePath` at the top level is an error when `bookshelves` is set | Move it to each shelf |
| 7 | `ResolvedReaderConfig` gains `shelves` and `defaultShelf` | Only affects code that constructs one by hand (`defineBooks(resolved)`) — add the fields, or use `resolveConfig()` |
| 8 | `package.json` `exports` gains `./plugins/agent` | None |

Unchanged for an app with one shelf and no plugins: the `.md` twin bodies are
byte-identical (§13, step 3), storage keys are unchanged, and `ReaderRoot`,
`ReaderChapter`, `getBooks()` and friends behave as today.

---

## 12. Implementation steps

### Step 1 — config (`src/config/index.ts`)

1. Types: `BookshelfConfig`, `ResolvedShelf`, `agent` and `bookshelves` on
   `ReaderUserConfig`, `shelves` and `defaultShelf` on `ResolvedReaderConfig`.
   `AgentPlugin` is imported as a type only.
2. `resolveConfig()`: build the implicit shelf or resolve `bookshelves`
   (§2.2, §2.4), then validate (§2.3) and report issues through the existing
   `ReaderConfigError` with paths like `bookshelves[1].basePath`.
3. Plugin validation uses `z.custom(isPluginLike)` — an object with a string
   `name` — so zod never touches functions.
4. Storage prefix defaults (§2.5).
5. `clientOptions(config, shelfId?)` returns the shelf's `reader`.

### Step 2 — content layer (`src/content/index.ts`)

1. `createApi()` takes a getter for a `ResolvedShelf` instead of a whole
   config. The book cache is keyed per shelf.
2. `getShelf(id?)`, `getShelves()`.
3. Module-level `getBooks`, `getBook`, … delegate to `getShelf()`.
4. `defineBooks()` keeps working, wrapping its config in an anonymous shelf.

### Step 3 — markdown (`src/agent/markdown.ts`)

1. `renderFrontmatter(fields)`.
2. `demoteHeadings(markdown, by)` on the mdast.
3. `fullTextToMarkdown(books, ctx, opts)` (§6.3).
4. `notFoundToMarkdown(info, ctx, opts)` (§7.1).
5. `resolveLastUpdated(entry, override?)` and `newest(entries)` helpers (§5.4).
6. `shelfToMarkdown` and `llmsTxt` accept a title and description, so they can
   use the shelf's.

### Step 4 — handler (`src/agent/handler.ts`)

1. New options (§3.2); remove `api`, `basePath`, `llms`.
2. Shelf lookup by base path, root-route lookup.
3. The pipeline in §3.3: plugin routes → core routes → `document` hooks →
   `headers` hooks.
4. `AgentDocument` construction and core metadata (§3.4).
5. `ctx.respond()` for plugin routes.
6. Method gating per route; `OPTIONS` reaches only plugins that declare it.
7. `setup()` hooks run once, when the shelves are first resolved.
8. Dev warning §10.1 and the `X-Zreader-Shelf` header.

### Step 5 — plugins (`src/plugins/agent/`)

A new top-level `src/plugins/` folder, one subfolder per plugin family. For
this release, `src/plugins/agent/` with one file each: `frontmatter.ts`,
`llms-txt.ts`, `not-found.ts`, `cors.ts`, `mcp.ts` (+ `mcp-search.ts`),
`disable.ts`, and `index.ts` re-exporting the factories and types. Heavy
imports are dynamic. The `AgentPlugin` types are defined here and imported
(type-only) by `src/agent/handler.ts` and `src/config/index.ts`.

### Step 6 — React and Next.js

1. `src/next/server/index.tsx`: `shelf` prop on `ReaderRoot` and
   `ReaderChapter`; `getBookParams(shelf?)`, `getChapterParams(shelf?)`;
   `devWarnings` prop; the §10.2 probe.
2. `src/react/context.tsx`: the §10.3 check in `ReaderProvider`
   (development only, in an effect).
3. `src/next/index.ts`: trace every shelf's content folder (§2.7).

### Step 7 — package

1. `package.json` `exports`: add `./plugins/agent` (server-only, with the same
   browser stub as `./agent`).
2. `tsup` entry for `src/plugins/agent/index.ts`.
3. `scripts/` bundle check: `zreader/plugins/agent` must not pull `unified`
   into its entry chunk.

### Step 8 — docs

- `docs/configuration.md`: a "Bookshelves" section — shape, the implicit
  shelf, validation, storage keys.
- `docs/nextjs.md`: `ReaderRoot shelf`, `ReaderChapter shelf`, the params
  helpers, one `app/` folder per shelf, tracing.
- `docs/troubleshooting.md`: one entry per dev warning (§10), quoting the
  message.
- `docs/agent.md`: rewritten around shelves and plugins — the core routes, the
  plugin table, one section per plugin, writing a plugin, the matcher (§10.4),
  the dev warnings, the `mtimeMs`-on-CI caveat.
- `docs/content.md`: "More than one content folder" now points at
  `bookshelves`; `defineBooks` is described as the escape hatch.
- `docs/api-reference.md`: every new export and option.
- `docs/README.md` and root `README.md`: the `zreader/agent` row mentions
  plugins; add a `zreader/plugins/agent` row; the Next.js snippet shows
  `shelf`.
- `CHANGELOG.md`: `0.3.0` with the additions and a "Migrating to 0.3" section
  for §11.

### Step 9 — tests

`test/config.test.ts`:

- No `bookshelves` → one shelf `books` with today's base path and content.
- Every rule in §2.3 produces its error, with the right path.
- Nesting (§2.3.1): `/books` + `/reports` and `/books` + `/bookstore` pass;
  `/books` + `/books/shelf1`, `/docs` + `/docs/books` and `/` + `/books` fail;
  `/books/` + `/books` (trailing slash) is a duplicate, not a nesting.
- Plugin merge: same-name replace keeps position; `disable()` removes.
- Storage prefix: default shelf `zr`, others `zr-<id>`, explicit wins.

`test/content.test.ts`:

- `getShelf("reports").getBooks()` returns only the reports shelf's books.
- `getBooks()` equals `getShelf().getBooks()`.

`test/agent.test.ts`:

- Two shelves: each `.md` route served by the right shelf; no cross-talk.
- `createAgentHandler({ shelves: ["reports"] })` ignores `/books/*`.
- No plugins: `/llms.txt` → `undefined`; bodies match the 0.2 fixtures.
- `frontmatter()`: field order, quoting, omission, `""` when empty; chapter
  default title `"Chapter — Book"`; `book` and `label` extras; 404 has no
  `canonical`; invalid extra keys rejected.
- `last_updated`: frontmatter `updated:` beats `mtimeMs`; override beats both;
  book = newest chapter; shelf = newest book; invalid dates skipped.
- `llmsTxt()`: `{basePath}/llms.txt` lists only that shelf; `root: true`
  serves `/llms.txt`; two `root: true` → config error.
- `llmsTxt({ full: true })`: every chapter present; body with H1 → no
  synthetic H3, H1 → H3; body without H1 → synthetic H3, H2 → H4; `#` in fenced
  code untouched; clamped at H6; memo reused on second request; `HEAD` doesn't
  build.
- `notFound()`: missing book → book list only; missing chapter → both lists;
  caps and the "…and N more" line; `render` overrides; only this shelf's books.
- `cors()`: `*` default; custom origin adds `Vary: Origin`; `vary` joined;
  `OPTIONS` → 204 with the right `Allow-Methods`; applied to plugin routes.
- `mcp()`: `initialize` → server info + tools capability;
  `tools/list`; `tools/call` for each tool; unknown id → `isError`; unknown
  method → `-32601`; bad JSON → `-32700`; batch; `GET {basePath}/mcp` →
  `undefined`; `search` override used.
- Dev warning §10.1 fires once for an unowned `.md` path and not in
  production; `X-Zreader-Shelf` present only in development.
- `matchAgentRoute` has no `llms` kind.

`test/plugins-import.test.ts` (new):

- Importing `zreader/plugins/agent` and calling every factory does not load
  `unified`, `zreader/content` or `zreader/virtual-config` (checked via the
  module graph / `require.cache`).

`test/next.test.ts` (new):

- `applyReaderConfig` traces every shelf's folder for `/**`, `proxy` and
  `middleware`.

`test/react.test.ts`:

- §10.3 warns when mounted outside `basePath`, once, and only in development.

### Step 10 — build checks

- `npm run typecheck`
- `npm test`
- `npm run build` (tsup + the bundle check + CSS build)
- `npm run lint:pkg` (publint + attw), now covering `./plugins/agent`
- `package.json` version `0.3.0`

---

## 13. Verification

1. `npm run typecheck && npm test && npm run build && npm run lint:pkg` green.
2. A fixture script that resolves a two-shelf config with every plugin on and
   prints every response — both shelves' `.md` routes, 404s, `llms.txt`,
   `llms-full.txt`, root `/llms.txt`, an MCP round trip, an `OPTIONS` preflight
   — with headers, to be eyeballed before release.
3. **Regression check:** with no `bookshelves` and no plugins, the shelf, book
   and chapter twin bodies are **byte-identical** to 0.2.x for the fixture
   books, and the 404 body is unchanged.
4. A Next 16 example app with two shelves: `next build` traces both folders;
   `next dev` shows the §10.2 warning when one matcher entry is removed and the
   §10.3 warning when an `app/` folder is renamed.
5. Run an MCP client (Claude Desktop or the MCP inspector) against
   `{basePath}/mcp` and call each tool.

---

## 14. Not in this release

| Addition | Why not |
| --- | --- |
| Markdown twins for **static site pages** (`/about`, `/developers`, …) | zreader has no page registry; it is a reader library, not a site framework. A `definePages()` API is a separate design conversation |
| `Accept: text/markdown` negotiation and AI-user-agent sniffing | Policy, not reader functionality. Belongs in the app's proxy; `cors({ vary })` keeps caches correct when a site does it |
| The `?mode=agent` capabilities document | A hand-written description of one site's API, auth and limits. Cannot be generated by a library |
| A site-wide `llms.txt` merging every shelf | Each shelf is scoped to itself by design; a site writes its own root index if it wants one |
| MCP sessions, SSE streaming, resources and prompts | Not needed for read-only tools; the stateless transport keeps the handler a pure `Request → Response` function |
| Per-route `Cache-Control` (e.g. shorter for `llms-full.txt`) | Can be added later as a plugin `headers` hook; noted in the docs |

---

## 15. Press-side follow-up

Once 0.3.0 ships, Alchemyst Press can drop its own book-level Markdown layer:

- `reader.config.ts` declares the `books` shelf with `frontmatter()`,
  `llmsTxt({ full: true, root: true })`, `notFound({ render })` (keeping its
  hand-written 404 copy), `cors({ vary: ["Accept", "User-Agent"] })` and
  `mcp()`.
- `apps/web/lib/agent/markdown.ts` shrinks to the static-page resolver
  (`resolveMarkdown`, `getAgentModeMarkdown`, `STATIC_META`) plus the
  `lib/markdown.ts` hand-written copy.
- `apps/web/app/md/[[...path]]/route.ts` delegates `/books*` to
  `createAgentHandler()` and keeps serving the static pages itself.
- `apps/web/app/mcp/route.ts` is replaced by `mcp()` at `/books/mcp`, or kept
  for its site-level tools and calls zreader's converters for `get_chapter`,
  removing the duplicated `<Callout>` → blockquote transform.

**Expected output changes** (diff all 45 chapters before switching): Press's
regex-based `mdxToMarkdown` and `htmlToMarkdown` produce different Markdown
from zreader's AST-based ones. `<Callout>` renders as a blockquote with a bold
title in both, but the surrounding whitespace differs; HTML tables and entity
handling differ more. Any consumer parsing `/books*.md` will see a diff.
