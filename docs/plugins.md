# Agent plugins

Everything `zreader/agent` does beyond the core `.md` twins is a **plugin**: a plain object you declare in `reader.config.ts`, scoped to one [bookshelf](./configuration.md#bookshelves). This page covers the ones that ship with zreader, and how to write your own.

```ts
// reader.config.ts
import { defineConfig, glob } from "zreader/config";
import { cors, frontmatter, llmsTxt, mcp, notFound } from "zreader/plugins/agent";
import { tocJson } from "./lib/toc-json"; // your own

export default defineConfig({
  agent: { plugins: [frontmatter(), notFound()] },   // every shelf
  bookshelves: [
    {
      id: "books",
      basePath: "/books",
      content: { loader: glob({ base: "./content/books" }) },
      agent: { plugins: [llmsTxt({ full: true, root: true }), cors(), tocJson()] },
    },
    { id: "reports", basePath: "/reports", content: { loader: glob({ base: "./content/reports" }) }, agent: { plugins: [mcp()] } },
  ],
});
```

## The built-ins

| Plugin | Adds | Detail |
| --- | --- | --- |
| `frontmatter(opts?)` | YAML frontmatter (`title`, `description`, `canonical`, `last_updated`, …) on every document | [agent.md](./agent.md#frontmatter) |
| `llmsTxt(opts?)` | `{basePath}/llms.txt`, `llms-full.txt`, and the site root with `root: true` | [agent.md](./agent.md#llmstxt-full-) |
| `notFound(opts?)` | A 404 document listing the valid book and chapter ids | [agent.md](./agent.md#notfound) |
| `cors(opts?)` | `Access-Control-Allow-Origin`, `Vary`, `OPTIONS` preflights | [agent.md](./agent.md#cors) |
| `mcp(opts?)` | A stateless MCP server at `POST {basePath}/mcp` | [agent.md](./agent.md#mcp) |
| `disable(name)` | Removes a plugin inherited from the top level | below |

### Where plugins run, and in what order

For each request the handler:

1. Matches **root routes** (`/llms.txt`) — the shelf that claimed the path answers.
2. Finds the shelf that owns the path. (Shelves [cannot be nested](./configuration.md#shelves-cannot-be-nested), so at most one does.)
3. Matches that shelf's **plugin routes**, in plugin order. The first match answers.
4. Otherwise matches the **core routes** (`GET`/`HEAD` on `.md` paths) and builds a document.
5. Runs every plugin's **`document` hook**, in plugin order.
6. Renders the response and runs every plugin's **`headers` hook**, in plugin order.

So order in the array is run order. `headers` hooks see responses from plugin routes too, which is why `cors()` covers `llms.txt` and MCP.

### Merging

Top-level `agent.plugins` run first, then the shelf's. A shelf plugin with the same `name` **replaces** the inherited one *in place*, keeping its position in the order. To drop one instead:

```ts
import { disable } from "zreader/plugins/agent";

bookshelves: [
  { id: "drafts", basePath: "/drafts", agent: { plugins: [disable("notFound")] } },
];
```

Two plugins with the same name on one shelf is a config error (`bookshelves[0].agent.plugins: two "llmsTxt" plugins`), as is a plugin that isn't an object with a string `name`.

---

## Writing a plugin

A plugin is a plain object. That's the whole API:

```ts
import type { AgentPlugin } from "zreader/plugins/agent";

export const robots = (): AgentPlugin => ({
  name: "robots",
  headers(h) {
    h.set("X-Robots-Tag", "noindex");
  },
});
```

```ts
export interface AgentPlugin {
  /** Unique within a shelf; a same-named plugin replaces it when merging. */
  name: string;
  /** Extra routes, relative to the shelf's basePath ("/llms.txt", "/mcp"). */
  routes?: AgentPluginRoute[];
  /** Root-level paths this plugin claims, outside any basePath ("/llms.txt"). */
  rootRoutes?: AgentPluginRoute[];
  /** Rewrite a core document before it is rendered. Runs in plugin order. */
  document?(doc: AgentDocument, ctx: AgentPluginContext): AgentDocument | Promise<AgentDocument>;
  /** Adjust headers on every response this shelf produces (core and plugin routes). */
  headers?(headers: Headers, ctx: AgentPluginContext & { status: number }): void;
  /** Called once per process per shelf when the handler resolves the shelf. */
  setup?(shelf: ResolvedShelf): void;
}

export interface AgentPluginRoute {
  /** e.g. "/llms.txt". `"*"` matches any path the shelf owns (used by cors()). */
  path: string;
  /** Defaults to ["GET", "HEAD"]. */
  methods?: Array<"GET" | "HEAD" | "POST" | "OPTIONS">;
  handle(request: Request, ctx: AgentPluginContext): Promise<Response> | Response;
}
```

### `headers` — touch every response

Runs after the response is built, for core *and* plugin routes. `ctx.status` is the status that was chosen, so you can skip errors.

```ts
/** A different cache for one route (e.g. a large llms-full.txt). */
export function cacheFor(path: string, value: string): AgentPlugin {
  return {
    name: `cacheFor(${path})`,
    headers(headers, ctx) {
      if (ctx.status !== 200) return;
      if (new URL(ctx.request.url).pathname !== path) return;
      headers.set("Cache-Control", value);
    },
  };
}

// cacheFor("/books/llms-full.txt", "public, max-age=3600")
```

### `document` — rewrite the Markdown

Runs for shelf, book, chapter and 404 documents, in plugin order. Return the document you were given (or a new one); the rendered body is `preamble.join("") + body`.

```ts
/** Append a word count to every chapter twin. */
export function wordCount(): AgentPlugin {
  return {
    name: "wordCount",
    document(doc) {
      if (doc.kind !== "chapter") return doc;
      const words = doc.body.split(/\s+/).filter(Boolean).length;
      return { ...doc, body: `${doc.body}\n\n---\n\n_${words} words._\n` };
    },
  };
}
```

`doc` also carries what the core already computed, so you rarely need to re-derive anything: `meta` (`title`, `description`, `canonical`, `lastUpdated`), `book`, `chapter`, or `notFound`.

Use `preamble` for anything that must sit *above* the body — a frontmatter block, a banner — rather than concatenating onto `body`. That way it stays first whatever order the plugins run in.

### `routes` — serve something new

`path` is relative to the shelf's `basePath`. Return `ctx.respond()`, not a bare `Response`, so the core headers and every `headers` hook still apply.

```ts
import type { AgentPlugin } from "zreader/plugins/agent";

/** {basePath}/toc.json — the catalogue as JSON, for your own tooling. */
export function tocJson(): AgentPlugin {
  return {
    name: "tocJson",
    routes: [
      {
        path: "/toc.json",
        handle: async (_request, ctx) => {
          const books = await ctx.api.getBooks();
          const json = books.map((book) => ({
            id: book.id,
            title: book.title,
            url: `${ctx.url.origin}${ctx.url.basePath}/${book.id}`,
            chapters: book.chapters.map((c) => ({ id: c.id, title: c.title, label: c.label })),
          }));
          return ctx.respond(JSON.stringify(json, null, 2), { type: "application/json" });
        },
      },
    ],
  };
}
```

Notes:

- `methods` defaults to `["GET", "HEAD"]`. Add `"POST"` for an endpoint, `"OPTIONS"` for a preflight.
- `path: "*"` matches **any** path the shelf owns. `cors()` uses it with `methods: ["OPTIONS"]`.
- `HEAD` is handled for you: `ctx.respond()` sends the body only for `GET`.
- The core only runs when no plugin route matched, so `POST {basePath}/mcp` never falls through to a book called `mcp`.

### `rootRoutes` — claim a path outside the basePath

Same shape, but relative to the site root. This is how `llmsTxt({ root: true })` serves `/llms.txt` from a shelf mounted at `/books`. Only one shelf may claim a given root path — two is a config error.

### `setup` — validate once

Called once per process, per shelf, before any request. Throw here for bad options; the handler wraps it as `zreader: agent plugin "x" failed setup: …`.

```ts
export function canonicalHost(host: string): AgentPlugin {
  return {
    name: "canonicalHost",
    setup() {
      if (!/^[\w.-]+(:\d+)?$/.test(host)) throw new Error(`canonicalHost: "${host}" is not a host`);
    },
    headers(headers, ctx) {
      const canonical = headers.get("link");
      if (ctx.status !== 200 || !canonical) return;
      headers.set("Link", canonical.replace(/(<https?:\/\/)[^/]+/, `$1${host}`));
    },
  };
}
```

### The context

Every hook gets the same `ctx`:

| Field | |
| --- | --- |
| `shelf` | The resolved shelf (`id`, `basePath`, `title`, `content`, `reader`, `plugins`) |
| `api` | The content source: `getBooks()`, `getBook(id)`, `getChapter(book, chapter)` |
| `url` | `{ origin, basePath }` — build links with `pageUrl(ctx.url, book, chapter)` |
| `request` | The live `Request` |
| `methods` | Methods the matched path accepts, in canonical order |
| `respond(body, init?)` | Build a response with the core headers + every `headers` hook. `init`: `{ status?, type?, canonical? }` |
| `document(match)` | Build a core document with every `document` hook applied. A missing id yields a `notFound` document |

`document()` is what `mcp()` uses to return exactly the Markdown the `.md` twin would — and what you'd use for any tool or endpoint that should stay consistent with the twins.

### Rules of thumb

- **Keep the factory light.** `reader.config.ts` is loaded by jiti inside `next.config`. Put `unified`, `zreader/content` and anything else heavy in a dynamic `import()` *inside* the hook:

  ```ts
  document: async (doc, ctx) => {
    const { demoteHeadings } = await import("zreader/agent");
    …
  };
  ```

  A test fails the build if `zreader/plugins/agent` ever gains a static import of `unified`, `zreader/content` or `zreader/virtual-config`.

- **Stay server-side.** `zreader/plugins/agent` resolves to a throwing stub in browser bundles. Declare plugins in `reader.config.ts` only; never import one into a client component.

- **Don't mutate the document.** Return a new one (`{ ...doc, body }`), so the order plugins run in stays predictable.

- **One shelf at a time.** `ctx.api` is that shelf's content, and route paths are relative to its `basePath`. Nothing reaches across shelves.

- **Name it after what it does.** The name is how merging, `disable()` and the config errors find it.

### Testing one

`createAgentHandler({ sources })` serves any content source as a shelf, so a plugin can be tested without a config file:

```ts
import { createAgentHandler } from "zreader/agent";
import { resolveConfig, glob } from "zreader/config";
import { defineBooks } from "zreader/content";

const config = resolveConfig({ content: { loader: glob({ base: "./content/books" }) } }, null, { root: process.cwd() });
const shelf = { ...config.shelves[0]!, basePath: "/books", plugins: [wordCount()] };

const agent = createAgentHandler({
  origin: "https://example.com",
  sources: [{ shelf, api: defineBooks(config) }],
});

const res = await agent(new Request("https://example.com/books/guide/intro.md"));
```
