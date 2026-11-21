# Agent-readable content

`zreader/agent` gives every reader page a **Markdown twin**, so LLMs, coding agents and crawlers can read a chapter without parsing the reader's HTML. It reads chapters from the [content layer](./content.md), runs on the server (Node 20.9+), and works with any framework that speaks `Request`/`Response`.

The core is small: it serves the `.md` twins and a one-line 404. Everything else — frontmatter, `llms.txt`, the rich 404, CORS and MCP — is an **opt-in plugin** from `zreader/plugins/agent`, scoped to one [bookshelf](./configuration.md#bookshelves).

```ts
// reader.config.ts
import { defineConfig, glob } from "zreader/config";
import { cors, frontmatter, llmsTxt, mcp, notFound } from "zreader/plugins/agent";

export default defineConfig({
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

## Core routes

For each shelf, relative to its `basePath`:

| URL | Returns | Content-Type |
| --- | --- | --- |
| `{basePath}.md` (`/index.md` when `basePath` is `/`) | The shelf: every book, linking to each book's `.md` | `text/markdown` |
| `{basePath}/<book>.md` | The book's title, subtitle, authors, description and table of contents | `text/markdown` |
| `{basePath}/<book>/<chapter>.md` | The chapter, with previous / contents / next links | `text/markdown` |

Plugins add more. `/llms.txt` is **no longer** a core route: add `llmsTxt({ root: true })`.

The twin of a page is its URL plus `.md`:

```
https://press.example.com/books/context-infra/appendix-a-api-endpoint-reference
https://press.example.com/books/context-infra/appendix-a-api-endpoint-reference.md
```

## Scope: one shelf at a time

Every agent document, index and tool covers **exactly one shelf's books**. Nothing reaches across shelves except the optional root `/llms.txt`, which one shelf must explicitly claim with `llmsTxt({ root: true })`.

Because [shelves cannot be nested](./configuration.md#shelves-cannot-be-nested), a path belongs to at most one shelf, so routing is unambiguous: under `/books`, the first segment is always a book id.

## Plugins

Plugins are declared in `reader.config.ts` (top level, per shelf, or both) and are **never sent to the client**. See [Agent plugins](./plugins.md) for how they run, how they merge, and how to write your own.

| Plugin | Adds |
| --- | --- |
| [`frontmatter()`](#frontmatter) | YAML frontmatter (`title`, `description`, `canonical`, `last_updated`, …) on every document |
| [`llmsTxt({ full })`](#llmstxt-full-) | `{basePath}/llms.txt`, and with `full`, `{basePath}/llms-full.txt` — this shelf's books only |
| [`notFound()`](#notfound) | A 404 document that lists the valid book and chapter ids |
| [`cors()`](#cors) | `Access-Control-Allow-Origin`, `Vary`, and `OPTIONS` preflights |
| [`mcp()`](#mcp) | A stateless MCP server at `POST {basePath}/mcp` |
| `disable(name)` | Drops a plugin inherited from the top level |

## `createAgentHandler(options?)`

```ts
import { createAgentHandler } from "zreader/agent";

const agent = createAgentHandler({ origin: "https://press.example.com" });
const response = await agent(request); // Response | undefined
```

It returns a function that takes a `Request` and resolves to a `Response`, or to `undefined` when the request isn't one of its URLs, so it composes with your own routing. With no arguments it serves **every** shelf in `reader.config.ts`.

| Option | Type | Default | |
| --- | --- | --- | --- |
| `shelves` | `string[]` | every shelf | Shelf ids to serve |
| `origin` | string | the request's `X-Forwarded-Host` / `Host` | Absolute origin for links, e.g. `"https://press.example.com"`. **Set it in production** |
| `cacheControl` | string | `public, max-age=0, s-maxage=3600, stale-while-revalidate=86400` | For successful responses |
| `devWarnings` | boolean | `true` | Log the [development warnings](#development-warnings) |
| `sources` | `{ shelf, api }[]` | the content layer | Advanced: serve a custom content source as a shelf (tests, non-file content) |

Behaviour:

- The core handles `GET` and `HEAD`; `HEAD` returns headers without a body. Plugins may add `POST` and `OPTIONS`. Any other method returns `undefined`.
- A `.md` URL for a book or chapter that doesn't exist returns a **404** written in Markdown with a link to the shelf, and `Cache-Control: no-store`. It does not fall through to your HTML pages. With `notFound()` the 404 lists the valid ids.
- The 404 only applies to paths the shelf owns. Anything else returns `undefined`.
- Paths with a malformed percent-encoding, or deeper than `/<book>/<chapter>.md`, return `undefined`.
- Response headers: `Content-Type: text/markdown; charset=utf-8` (`text/plain` for `llms.txt`), `Link: <page-url>; rel="canonical"` pointing at the HTML page, `X-Content-Type-Options: nosniff`, and `Cache-Control`. In development, also `X-Zreader-Shelf: <id>`.
- Drafts follow `content.includeDrafts`: served in development, 404 in production.
- Conversions are cached in memory per file and modification time.

### Origin

Links in the Markdown need an absolute origin. Without `origin`, the handler uses the first `X-Forwarded-Host` (else `Host`) header and `X-Forwarded-Proto`, ignoring malformed values, then the request URL. Behind Next.js's standalone server the request URL alone would be `http://0.0.0.0:3000`, which is why headers come first.

Host headers can be spoofed, and responses are cacheable (`s-maxage`), so set `origin` explicitly in production.

---

## `frontmatter()`

```ts
import { frontmatter } from "zreader/plugins/agent";

frontmatter();
frontmatter({ title: (doc) => `[${doc.meta.title}]`, extra: (doc) => ({ site: "Press" }) });
```

Adds a YAML block above the body of every shelf, book, chapter and 404 document:

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

Not applied to `llms.txt`, `llms-full.txt` or MCP responses.

| Option | |
| --- | --- |
| `title(doc)` | Default: chapter → `"Chapter — Book"`; book → the book title; shelf → the shelf title |
| `lastUpdated(entry)` | Override how `last_updated` is found |
| `extra(doc)` | Extra fields, appended after the standard ones in insertion order |

Default extras: chapters get `book` (the book title) and `label` (when set). Books and the shelf get none.

Rendering rules (also exported as `renderFrontmatter(fields)` from `zreader/agent`):

- Field order: `title`, `description`, `canonical`, `last_updated`, then extras.
- Every value is a JSON string, which is a valid YAML double-quoted scalar. Whitespace runs collapse to a single space first.
- `undefined` and empty values are omitted; nothing is emitted when every field is empty.
- Extra keys must match `/^[A-Za-z_][\w-]*$/`. Invalid keys are dropped with a development warning; `renderFrontmatter()` throws.
- 404 documents get `title` and `description`, never `canonical`.

### `last_updated`

Resolved per chapter, first valid hit wins:

1. `lastUpdated(entry)`, if given.
2. The chapter's own frontmatter: `updated`, `lastUpdated`, `last_updated`, `date`.
3. The file's `mtimeMs`.

Formatted `YYYY-MM-DD`, in UTC. A book's value is the newest across its chapters; the shelf's is the newest across its books.

> **On CI and most hosts, `mtimeMs` is the checkout time**, because `git clone` does not preserve modification times. For dates that are stable across deploys, set `updated:` in chapter frontmatter or pass `lastUpdated` (e.g. reading `git log -1 --format=%cs` at build time).

---

## `llmsTxt({ full })`

```ts
import { llmsTxt } from "zreader/plugins/agent";

llmsTxt();                          // {basePath}/llms.txt
llmsTxt({ full: true });            // + {basePath}/llms-full.txt
llmsTxt({ root: true });            // + /llms.txt at the site root
```

| Option | Default | |
| --- | --- | --- |
| `full` | `false` | Also serve `{basePath}/llms-full.txt` |
| `root` | `false` | Also serve `/llms.txt` (and `/llms-full.txt` with `full`) at the site root. **One shelf only** |
| `title` | the shelf title, or the book title for a one-book shelf | H1 |
| `description` | the shelf description | Summary line |

| Path | Content-Type | Content |
| --- | --- | --- |
| `{basePath}/llms.txt` | `text/plain` | An [llms.txt](https://llmstxt.org) index of this shelf's books |
| `{basePath}/llms-full.txt` | `text/markdown` | Every chapter of this shelf, concatenated |
| `/llms.txt`, `/llms-full.txt` | as above | With `root: true`: the same documents, for this shelf only |

With `basePath: "/"`, `{basePath}/llms.txt` *is* `/llms.txt`; `root` is then implied.

`root: true` serves only the claiming shelf's books. A site-wide index across shelves is a link list a site can write itself; zreader does not merge shelves. Two shelves claiming `/llms.txt` is a config error.

`llms.txt`:

```md
# Context Infrastructure

> Build AI that understands your business.

## Context Infrastructure

- [Table of contents](https://press.example.com/books/context-infra.md)
- [Intro](https://press.example.com/books/context-infra/intro.md)
```

### `llms-full.txt`

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

- H1 for the document, H2 per book, H3 per chapter, so chapter content starts at H4.
- If the chapter body has its own H1, the synthetic `### title` is not emitted; the body's headings are demoted by **2** either way (so its H1 becomes the chapter's H3).
- Depth is clamped at 6.
- Demotion runs on the mdast, so `#` lines inside fenced code are untouched.
- Chapter bodies go through `chapterBodyToMarkdown()`, so MDX is cleaned and HTML is converted exactly as in the single-chapter twin.

**Caching and cost:** the assembled document is memoised per shelf, keyed on every chapter's file and `mtimeMs`, so unchanged content is concatenated once per process. `HEAD` returns headers without building it. The document can be large; CDN-cache it. A separate cache control per route is out of scope — add a plugin `headers` hook if you need one.

---

## `notFound()`

```ts
import { notFound } from "zreader/plugins/agent";

notFound();
notFound({ maxBooks: 20, maxChapters: 50, render: (info) => `…` });
```

Replaces the core's one-line 404 with a document that lists the valid ids, so an agent that guessed can correct itself:

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
- Lists are capped (`maxBooks` 50, `maxChapters` 100). Past the cap: `- …and 12 more; see the [index](…/llms.txt)` (or the shelf `.md` when `llmsTxt` is not enabled).
- Only this shelf's books are listed.

HTTP 404, `Cache-Control: no-store`, `text/markdown`. `frontmatter()` adds its block when that plugin is also enabled.

| Option | |
| --- | --- |
| `title` | H1, default `"Not found"` |
| `maxBooks`, `maxChapters` | List caps |
| `render(info)` | Replace the body entirely |

---

## `cors()`

```ts
import { cors } from "zreader/plugins/agent";

cors();
cors({ origin: "https://app.example.com", vary: ["Accept", "User-Agent"] });
```

- Sets `Access-Control-Allow-Origin` (and `Vary` when given) on every response the shelf produces: twins, 404s, `llms*.txt`, MCP.
- Answers `OPTIONS` on every route of the shelf with a 204, allowing the methods that route accepts, plus `Content-Type`, `Mcp-Session-Id` and `Mcp-Protocol-Version`.
- With a non-`*` `origin`, also adds `Origin` to `Vary`.
- `maxAge` (default `86400`) sets `Access-Control-Max-Age` on preflights.

Why opt-in: the documents are public, but the `CopyReference` flow does not need CORS (it opens `chatgpt.com/?q=…` and the assistant fetches server-side). CORS matters for browser-side agents, extensions and browser MCP clients, which a site enables deliberately.

---

## `mcp()`

A stateless MCP server over the Streamable HTTP transport, at `POST {basePath}/mcp`:

- JSON-RPC 2.0 over `POST`; every response is `application/json` (no SSE stream, no sessions, no server-initiated messages).
- `GET` and `DELETE` are **not** handled, so they fall through to the app. A book with the id `mcp` keeps its HTML page at `GET /reports/mcp`.
- Methods: `initialize`, `notifications/initialized` (202, no body), `ping`, `tools/list`, `tools/call`. Anything else → `-32601`.
- Batched requests are supported. Malformed JSON → `-32700`.
- Hand-rolled, with no dependency on `@modelcontextprotocol/sdk`. The trade-off is that spec changes are tracked by hand: the protocol version is a constant (`MCP_PROTOCOL_VERSION`) in one place, and this release implements revision **2025-06-18**.

### Tools

| Tool | Input | Output |
| --- | --- | --- |
| `list_books` | — | `[{ id, title, subtitle, authors, description, chapters: [{ id, title, label, description }] }]` |
| `get_book` | `{ book }` | The book `.md` document (with plugin `document` hooks applied) |
| `get_chapter` | `{ book, chapter }` | The chapter `.md` document (with plugin `document` hooks applied) |
| `search` | `{ query, book?, limit? = 10 }` | `[{ book, chapter, title, url, snippet, score }]` |

Unknown ids return a tool result with `isError: true` and the `notFound()` text when that plugin is on.

### Options

| Option | Default | |
| --- | --- | --- |
| `path` | `"/mcp"` | Route, relative to `basePath` |
| `name` | `zreader-${shelf.id}` | Server name in `initialize` |
| `search(query, books, opts)` | BM25 over the shelf | Replace the default search |
| `tools` | all on | Disable individual tools |

### Default search

An in-memory index built lazily per shelf from `chapterBodyToMarkdown()` output, memoised on the same file / `mtimeMs` key:

- Lower-cased, diacritic-folded terms; title matches weigh more than body matches.
- Scored with BM25 over chapters; a snippet is the ~200 characters around the first match.
- Good enough for a shelf of hundreds of chapters. Anything larger passes `search`.

### Security

Read-only tools over public content; no auth. The docs say so, and point at the app's own proxy for rate limiting or auth if a site needs it.

---

## Writing a plugin

A plugin is a plain object with a `name` and whichever hooks it needs. Heavy dependencies go in a dynamic `import()` inside the hook, so `reader.config.ts` stays cheap to load in `next.config`:

```ts
import type { AgentPlugin } from "zreader/plugins/agent";

const robots = (): AgentPlugin => ({
  name: "robots",
  headers(h) {
    h.set("X-Robots-Tag", "noindex");
  },
});
```

Hooks: `headers` (every response), `document` (rewrite the Markdown), `routes` / `rootRoutes` (serve something new), `setup` (validate once). `ctx.respond(body, init)` builds a response with the core headers plus every plugin's `headers` hook, so `cors()` applies to plugin routes too.

See **[Agent plugins](./plugins.md)** for the full guide: the pipeline, the context, worked examples and the rules of thumb.

---

## Next.js

```ts
// proxy.ts (Next 16)
import { NextResponse } from "next/server";
import { createAgentHandler } from "zreader/agent";

const agent = createAgentHandler({ origin: "https://press.example.com" });

export async function proxy(req: Request) {
  return (await agent(req)) ?? NextResponse.next();
}

export const config = {
  matcher: [
    "/books.md", "/books/:path*.md", "/books/llms.txt", "/books/llms-full.txt", "/books/:book/_assets/:path*",
    "/reports.md", "/reports/:path*.md", "/reports/llms.txt", "/reports/mcp", "/reports/:book/_assets/:path*",
    "/llms.txt", "/llms-full.txt",
  ],
};
```

The `_assets` entries serve [images next to chapters](./images.md#images-next-to-chapters); the handler answers them too (`createAgentHandler({ assets: false })` turns that off).

On **Next 15.5**, name the file `middleware.ts`, export the function as `middleware`, and add `runtime: "nodejs"` to `config`. The handler reads files from disk, so it can't run on the Edge runtime.

Next.js requires `config.matcher` to be a static literal, so zreader cannot generate it from your config. The recommended form is **one literal matcher per shelf**; the [development warnings](#development-warnings) catch it when it goes stale. The alternative is a broad matcher (`"/((?!_next/|favicon.ico).*)"`) with the handler returning `undefined` for anything it doesn't own: it never goes stale, at the cost of running the proxy on every request.

If you already have a proxy, call the handler first and fall through to your logic:

```ts
export async function proxy(req: NextRequest) {
  const md = await agent(req);
  if (md) return md;
  return yourExistingProxy(req);
}
```

Then turn on the button and discovery tag with `<ReaderRoot agent>`; see [Copy Reference](./copy-reference.md#readerroot-agent).

## Vite

A small plugin serves the twins from `vite dev` and `vite preview`:

```ts
// vite.config.ts
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createAgentHandler } from "zreader/agent";

function zreaderAgent(): Plugin {
  const handle = createAgentHandler();
  const middleware = async (req: any, res: any, next: () => void) => {
    const response = await handle(new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers }));
    if (!response) return next();
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(await response.text());
  };
  return {
    name: "zreader-agent",
    configureServer: (server) => void server.middlewares.use(middleware),
    configurePreviewServer: (server) => void server.middlewares.use(middleware),
  };
}

export default defineConfig({ plugins: [react(), zreaderAgent()] });
```

A built Vite app is static files: in production, put the same handler in the server that serves them (Express, Hono, a worker with file access).

## Express

```ts
import express from "express";
import { createAgentHandler } from "zreader/agent";

const agent = createAgentHandler({ origin: "https://press.example.com" });
const app = express();

app.use(async (req, res, next) => {
  const response = await agent(new Request(`http://${req.headers.host}${req.originalUrl}`, { method: req.method, headers: req.headers as HeadersInit }));
  if (!response) return next();
  res.status(response.status);
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.send(await response.text());
});

app.use(express.static("dist"));
```

## Hono

```ts
import { Hono } from "hono";
import { createAgentHandler } from "zreader/agent";

const agent = createAgentHandler({ origin: "https://press.example.com" });
const app = new Hono();

app.use("*", async (c, next) => (await agent(c.req.raw)) ?? next());
```

## React Router (framework mode), Remix

Route matching can't select by suffix: `/books/guide/intro.md` also matches a `books/:book/:chapter` route, with `chapter = "intro.md"`. Handle the twins in front of the router instead:

- With a custom server (`@react-router/express`, Hono), add the [Express](#express) or [Hono](#hono) middleware before the request handler.
- Or check the suffix in the chapter route's loader:

```ts
// app/routes/chapter.tsx (route "books/:book/:chapter")
import { createAgentHandler } from "zreader/agent";

const agent = createAgentHandler();

export async function loader({ request, params }: { request: Request; params: { chapter: string } }) {
  if (params.chapter.endsWith(".md")) return (await agent(request)) ?? new Response("Not found", { status: 404 });
  // …load the chapter for the page
}
```

`{basePath}.md`, `{basePath}/<book>.md` and the plugin routes need routes of their own in that case.

## No server

A purely static site has nothing to answer `.md` requests. Use `<CopyReference />` without `markdown` (it copies the page URL), or host Markdown elsewhere and pass `markdown={(pageUrl) => …}`. See [Copy Reference](./copy-reference.md).

## Discovery

- `llmsTxt()` serves `{basePath}/llms.txt`, listing every chapter's twin; with `root: true`, the site's `/llms.txt` too.
- `<MarkdownAlternate />` (or `<ReaderRoot agent>`) adds `<link rel="alternate" type="text/markdown" href="….md">` to each chapter's `<head>`.
- Each twin's `Link: rel="canonical"` header points back at the HTML page, so search engines keep indexing the page rather than the twin.

## Converters

Everything the handler does is exported for your own routes, scripts or static generation:

| Export | |
| --- | --- |
| `chapterToMarkdown(lookup, { origin, basePath })` | A chapter (from `getChapter()`) as a full document with nav links |
| `bookToMarkdown(book, ctx)` | A book's contents page |
| `shelfToMarkdown(books, ctx, { title?, description? })` | The shelf |
| `llmsTxt(books, ctx, { title?, description? })` | `llms.txt` |
| `fullTextToMarkdown(books, ctx, { title?, description? })` | `llms-full.txt` |
| `notFoundToMarkdown(info, ctx, opts?)` | The rich 404 |
| `renderFrontmatter(fields)`, `isValidFrontmatterKey(key)` | The frontmatter block |
| `demoteHeadings(markdown, by)` | Shift every heading down, on the mdast |
| `resolveLastUpdated(entry, override?)`, `newestLastUpdated(entries, override?)`, `newestBookLastUpdated(books, override?)` | `last_updated` helpers |
| `chapterBodyToMarkdown(entry)` | Just the chapter body (cached) |
| `mdxToMarkdown(source)`, `htmlToMarkdown(html)` | The raw converters |
| `pageUrl(ctx, book?, chapter?)`, `markdownPageUrl(ctx, book?, chapter?)` | URL builders |
| `matchAgentRoute(pathname, basePath)` | The route matcher: `AgentRouteMatch \| null` (`"shelf"`, `"book"` or `"chapter"`) |
| `requestOrigin(request)` | The origin the handler would use |

Converters stay pure: they return plain Markdown. Plugins decorate the *handler's* output, so calling a converter directly still gives you a clean document.

Writing static `.md` files at build time:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { getBooks, getChapter } from "zreader/content";
import { chapterToMarkdown } from "zreader/agent";

const ctx = { origin: "https://press.example.com", basePath: "/books" };
for (const book of await getBooks()) {
  for (const ch of book.chapters) {
    const file = `dist/books/${book.id}/${ch.id}.md`;
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, await chapterToMarkdown((await getChapter(book.id, ch.id))!, ctx));
  }
}
```

## Development warnings

All are `NODE_ENV === "development"` only, `console.warn` with a `[zreader]` prefix, fire once per process per shelf, and are silenced with `createAgentHandler({ devWarnings: false })` or `<ReaderRoot devWarnings={false}>`.

### A request reached the handler, but no shelf owns it

This is what a stale matcher looks like after `basePath` was renamed from `/books` to `/read`:

```
[zreader] /books/intro.md reached the agent handler, but no bookshelf has basePath "/books".
          Bookshelves: books → /read, reports → /reports.
          Update the matcher in proxy.ts to the new base path.
```

Triggered only for paths that look like agent routes (end in `.md`, `/llms.txt`, `/llms-full.txt`, or are a `POST` to `…/mcp`).

### `ReaderRoot` advertises twins the proxy doesn't serve

`<ReaderRoot agent>` links to `.md` twins. In development, the first time it renders for a shelf it fires a background `HEAD {origin}{basePath}.md` (never awaited, never blocks rendering). If the response lacks the `X-Zreader-Shelf` header the handler stamps in development:

```
[zreader] <ReaderRoot shelf="reports" agent> links to /reports/*.md, but /reports.md
          is not served by createAgentHandler(). Add these to the matcher in proxy.ts:
            "/reports.md", "/reports/:path*.md", "/reports/llms.txt", "/reports/mcp"
```

The suggested matcher lists only the routes that shelf's plugins actually enable.

### The reader is mounted outside its base path

Client-side, in `ReaderProvider`: if `window.location.pathname` is not under the provider's `basePath`, every `hrefFor` link is wrong. This is what a renamed `basePath` without a renamed `app/` folder looks like:

```
[zreader] This reader's basePath is "/read", but it is mounted at /books/intro.
          Rename app/books/ to app/read/, or set basePath back to "/books".
```

## Deployment

- The handler reads each shelf's content folder at runtime, so those files must be deployed with the server. `withReader` adds them to Next.js's file tracing; with other frameworks, include the content folders in your deploy.
- **Next.js + Turbopack:** tracing includes aren't applied to the proxy. `next start` and `output: "standalone"` still work; on hosts that deploy the proxy as a separate function, verify the `.md` URLs after deploying, or build with `next build --webpack`.
- The twins expose the same text as the pages. Drafts are only served when drafts are included (development by default).
