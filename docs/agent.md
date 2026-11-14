# Agent-readable content

`zreader/agent` gives every reader page a **Markdown twin**, so LLMs, coding agents and crawlers can read a chapter without parsing the reader's HTML. It reads chapters from the [content layer](./content.md), runs on the server (Node 20.9+), and works with any framework that speaks `Request`/`Response`.

## URLs

With the default `basePath` (`/books`):

| URL | Returns | Content-Type |
| --- | --- | --- |
| `/books/<book>/<chapter>.md` | The chapter as Markdown, with previous / contents / next links | `text/markdown` |
| `/books/<book>.md` | The book's title, subtitle, authors, description and table of contents | `text/markdown` |
| `/books.md` | Every book, linking to each book's `.md` | `text/markdown` |
| `/llms.txt` | An [llms.txt](https://llmstxt.org) index of every chapter's `.md` | `text/plain` |

The twin of a page is its URL plus `.md`:

```
https://press.example.com/books/context-infra/appendix-a-api-endpoint-reference
https://press.example.com/books/context-infra/appendix-a-api-endpoint-reference.md
```

With `basePath: "/"`, the shelf is `/index.md`.

## What the responses look like

A chapter:

```md
# API Endpoint Reference

## Endpoints

> **Note**
>
> Auth required.

| Method | Path        |
| ------ | ----------- |
| GET    | /v1/context |

---

- Previous: [Intro](https://press.example.com/books/context-infra/intro.md)
- Contents: [Context Infrastructure](https://press.example.com/books/context-infra.md)
```

- The title comes from frontmatter, added as `# Title` unless the chapter already has an H1.
- Markdown chapters are served as written; MDX is cleaned up; HTML is converted. See [Formats](./formats.md) for exactly what survives.
- Links between twins are absolute.

A book (`/books/context-infra.md`):

```md
# Context Infrastructure

Build AI that understands your business.

## Contents

- [Intro](https://press.example.com/books/context-infra/intro.md)
- [Appendix A: API Endpoint Reference](https://press.example.com/books/context-infra/appendix-a-api-endpoint-reference.md)

---

- All books: [Shelf](https://press.example.com/books.md)
```

Chapters with a `part` are grouped under `### <part>` headings; chapter `description`s follow each link.

`/llms.txt`:

```md
# Context Infrastructure

> Build AI that understands your business.

## Context Infrastructure

- [Table of contents](https://press.example.com/books/context-infra.md)
- [Intro](https://press.example.com/books/context-infra/intro.md)
- [Appendix A: API Endpoint Reference](https://press.example.com/books/context-infra/appendix-a-api-endpoint-reference.md)
```

The H1 is the book's title when there's one book and "Books" otherwise; the summary is that book's description or a generic line. Override both with the `llms` option.

## `createAgentHandler(options?)`

```ts
import { createAgentHandler } from "zreader/agent";

const agent = createAgentHandler({ origin: "https://press.example.com" });
const response = await agent(request); // Response | undefined
```

It returns a function that takes a `Request` and resolves to a `Response`, or to `undefined` when the request isn't one of its URLs, so it composes with your own routing.

| Option | Type | Default | |
| --- | --- | --- | --- |
| `origin` | string | the request's `X-Forwarded-Host` / `Host` | Absolute origin for links, e.g. `"https://press.example.com"`. **Set it in production** |
| `basePath` | string | `reader.basePath` from `reader.config.ts` (`/books`) | |
| `api` | content source | the global content layer | Any object with `getBooks`, `getBook`, `getChapter`, e.g. `defineBooks(…)` |
| `llms` | `boolean \| { title?, description? }` | `true` | Serve `/llms.txt`, optionally with a custom H1 and summary |
| `cacheControl` | string | `public, max-age=0, s-maxage=3600, stale-while-revalidate=86400` | For successful responses |

Behaviour:

- Only `GET` and `HEAD` are handled; `HEAD` returns headers without a body. Other methods return `undefined`.
- A `.md` URL for a book or chapter that doesn't exist returns a **404** written in Markdown with a link to the shelf, and `Cache-Control: no-store`. It does not fall through to your HTML pages.
- Paths with a malformed percent-encoding, or deeper than `/<book>/<chapter>.md`, return `undefined`.
- Response headers: `Content-Type: text/markdown; charset=utf-8` (`text/plain` for `llms.txt`), `Link: <page-url>; rel="canonical"` pointing at the HTML page, `X-Content-Type-Options: nosniff`, and `Cache-Control`.
- Drafts follow `content.includeDrafts`: served in development, 404 in production.
- Conversions are cached in memory per file and modification time.

### Origin

Links in the Markdown need an absolute origin. Without `origin`, the handler uses the first `X-Forwarded-Host` (else `Host`) header and `X-Forwarded-Proto`, ignoring malformed values, then the request URL. Behind Next.js's standalone server the request URL alone would be `http://0.0.0.0:3000`, which is why headers come first.

Host headers can be spoofed, and responses are cacheable (`s-maxage`), so set `origin` explicitly in production.

## Next.js

```ts
// proxy.ts (Next 16)
import { NextResponse } from "next/server";
import { createAgentHandler } from "zreader/agent";

const agent = createAgentHandler({ origin: "https://press.example.com" });

export async function proxy(req: Request) {
  return (await agent(req)) ?? NextResponse.next();
}
export const config = { matcher: ["/books/:path*.md", "/books.md", "/llms.txt"] };
```

On **Next 15.5**, name the file `middleware.ts`, export the function as `middleware`, and add `runtime: "nodejs"` to `config`. The handler reads files from disk, so it can't run on the Edge runtime.

**Keep the matcher in sync with `reader.basePath`.** Next.js reads `matcher` from the file at build time, so it must be a literal and can't be imported. With `basePath: "/read"`, use `["/read/:path*.md", "/read.md", "/llms.txt"]`.

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

`/books.md`, `/books/<book>.md` and `/llms.txt` need routes of their own in that case.

## No server

A purely static site has nothing to answer `.md` requests. Use `<CopyReference />` without `markdown` (it copies the page URL), or host Markdown elsewhere and pass `markdown={(pageUrl) => …}`. See [Copy Reference](./copy-reference.md).

## Discovery

- `/llms.txt` lists every chapter's twin.
- `<MarkdownAlternate />` (or `<ReaderRoot agent>`) adds `<link rel="alternate" type="text/markdown" href="….md">` to each chapter's `<head>`.
- Each twin's `Link: rel="canonical"` header points back at the HTML page, so search engines keep indexing the page rather than the twin.

## Converters

Everything the handler does is exported for your own routes, scripts or static generation:

| Export | |
| --- | --- |
| `chapterToMarkdown(lookup, { origin, basePath })` | A chapter (from `getChapter()`) as a full document with nav links |
| `bookToMarkdown(book, ctx)` | A book's contents page |
| `shelfToMarkdown(books, ctx)` | The shelf |
| `llmsTxt(books, ctx, { title?, description? })` | `llms.txt` |
| `chapterBodyToMarkdown(entry)` | Just the chapter body (cached) |
| `mdxToMarkdown(source)`, `htmlToMarkdown(html)` | The raw converters |
| `pageUrl(ctx, book?, chapter?)`, `markdownPageUrl(ctx, book?, chapter?)` | URL builders |
| `matchAgentRoute(pathname, basePath, llms?)` | The route matcher: `{ kind: "shelf" \| "book" \| "chapter" \| "llms", … } \| null` |
| `requestOrigin(request)` | The origin the handler would use |

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

## Deployment

- The handler reads `content/books/**` at runtime, so those files must be deployed with the server. `withReader` adds them to Next.js's file tracing; with other frameworks, include the content folder in your deploy.
- **Next.js + Turbopack:** tracing includes aren't applied to the proxy. `next start` and `output: "standalone"` still work; on hosts that deploy the proxy as a separate function, verify the `.md` URLs after deploying, or build with `next build --webpack`.
- The twins expose the same text as the pages. Drafts are only served when drafts are included (development by default).
