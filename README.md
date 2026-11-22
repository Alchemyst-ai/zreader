# zreader

A localStorage-first, mobile-first book reader for React — for books written in **Markdown, MDX and HTML**, not EPUB.

Readers get sentence highlights with notes, bookmarks, reading progress, a Markdown scratchpad and reading settings, and everything they do stays in their browser. Chapters can carry images and TeX math, rendered at build time. Every page also gets a **Markdown twin** an LLM can fetch, so the book is an API as well as a site.

```sh
npm i zreader
# the scratchpad: lazy-loaded, but bundlers resolve it at build time, so install it
npm i @tiptap/react @tiptap/pm @tiptap/core @tiptap/starter-kit @tiptap/extension-list @tiptap/extensions @tiptap/markdown
# optional: math, with one engine of your choice (content.math in reader.config.ts)
npm i katex          # or: temml, @mathjax/src
```

Runnable apps: [`examples/next-shadcn`](./examples/next-shadcn) and [`examples/vite-shadcn`](./examples/vite-shadcn). Before shipping, go through the [production checklist](./docs/production-checklist.md).

## What you get

**For readers**

- **Sentence highlights** — select text, or switch on highlight mode and tap a sentence. Up to six colours (four by default), a note on any highlight, and a list per book. Highlights over math keep the TeX when copied, exported or quoted.
- **Bookmarks** on any block, including images and display formulas, with an excerpt and an undo.
- **Reading progress** that resumes where they left off and marks chapters read.
- **A WYSIWYG Markdown scratchpad** (Tiptap) with checklists — a pad per chapter, per book and a global one, and highlights quote straight into it. Images pasted into the pad or a note are kept in the browser (IndexedDB), and with [scratchpad math](./docs/math.md#in-the-scratchpad) `$…$` renders as formulas you can click to edit.
- **[Runnable code](./docs/sandbox.md)** in the pad (opt-in): Python, JavaScript and TypeScript that run in the reader's own browser, notebook-style, with plots, kept in the pad's Markdown.
- **A full-screen image viewer** with pinch and wheel zoom.
- **Offline reading** (opt-in): save a whole book, images included.
- **Reading settings**: theme (light, sepia, dark), text size, line spacing, line width and font.
- **JSON backup and restore**, images included, with a reminder that their notes live only in this browser.
- None of it needs an account, a server or a network call.

**For you**

- One `ReaderProvider` and three components — `BookShelf`, `BookContents`, `Reader` — driven by a plain `BookMeta[]` catalogue. It can come from JSON, a CMS, a fetch or a folder of files.
- Runs on **Vite, React Router, Remix, TanStack or Next.js**. Next.js gets an optional adapter that compiles chapters and generates every page statically.
- An optional **content layer** for `content/books/**`: Markdown, MDX and HTML, with frontmatter schemas, ordering, parts, drafts and DOMPurify sanitizing.
- **[Images](./docs/images.md)** from files next to the chapter (served with immutable, content-hashed URLs), URLs or base64. Measured at build time, captioned, lazy-loaded, and rendered through `next/image` under Next.js. Remote hosts and base64 sizes are limits you set.
- **[Math](./docs/math.md)** with KaTeX, Temml or MathJax, rendered as MathML on the server: no math JavaScript or fonts for readers. Opt-in.
- **Mobile-first UI** on shadcn/ui, styled by a precompiled stylesheet or your own Tailwind v4 tokens.
- Highlights anchor to stable **block ids** and survive edits; a build-time rehype plugin puts the same ids in the HTML before first paint.
- **Bookshelves**: several independent readers on one site, each with its own route, content folder and plugins.

**For agents** (optional, server-side)

- A `.md` twin for every shelf, book and chapter: `/books.md`, `/books/<book>.md`, `/books/<book>/<chapter>.md`.
- `llms.txt` and `llms-full.txt` indexes, YAML frontmatter, a self-describing 404, CORS and a **stateless MCP server** — all opt-in plugins.
- A **Copy reference** button that hands the current chapter to ChatGPT, Claude or Grok.
- `createAgentHandler()` is one `Request → Response` function, so it runs in a Next.js proxy, Express, Hono or a Vite dev plugin.

Everything past the twins is a plugin, and plugins are yours to write. They're plain objects with a `name` and whichever hooks they need:

```ts
// reader.config.ts
import { defineConfig } from "zreader/config";
import type { AgentPlugin } from "zreader/plugins/agent";

const robots = (): AgentPlugin => ({
  name: "robots",
  headers(h) {
    h.set("X-Robots-Tag", "noindex");
  },
});

export default defineConfig({ agent: { plugins: [robots()] } });
```

`headers` touches every response, `document` rewrites the Markdown, `routes` serves new paths under the shelf's `basePath`, and `setup` validates options once. See [Agent plugins](./docs/plugins.md).

## How it compares

Most React reader packages — `react-reader`, `epub.js` and its forks — are **EPUB viewers**. They point at an `.epub` URL, render it into an iframe, and leave persistence, notes and progress to you: their own docs tell you to "use a state from local-storage".

zreader is the other shape:

| | EPUB viewers | zreader |
| --- | --- | --- |
| Input | An `.epub` file | Markdown, MDX or HTML chapters — files, a CMS, or React children |
| Rendering | In an iframe, publisher CSS and all | In your page, with your components and your theme |
| Highlights, notes, bookmarks, progress | Your job | Built in, versioned, in `localStorage`, with backup/restore |
| Fixing a typo | Rearchive and re-upload the EPUB | Edit the file; highlights re-anchor |
| For LLMs | The text is inside a zip | A `.md` twin per page, `llms.txt`, and an MCP server |
| Images and math | Whatever the EPUB packs | Files next to the chapter, `next/image`, TeX → MathML at build time |
| Inside a chapter | Whatever the EPUB allows | Your MDX components |

It is **not** an EPUB reader and doesn't try to be. If your book lives as files in a repo — a technical book, a handbook, course notes, a changelog, a docs site — zreader turns it into a reading app.

## Quick start

Next.js, with chapters in `content/books/<book>/`:

```ts
// next.config.ts
import { withReader } from "zreader/next";
export default withReader({});
```

```tsx
// app/books/layout.tsx
import { ReaderRoot } from "zreader/next/server";
import "zreader/styles.css";
export default function Layout({ children }) {
  return <ReaderRoot>{children}</ReaderRoot>;
}

// app/books/page.tsx
import { BookShelf } from "zreader/react";
export default function Page() { return <BookShelf />; }

// app/books/[book]/[chapter]/page.tsx
import { getChapterParams, ReaderChapter } from "zreader/next/server";
export const generateStaticParams = getChapterParams;
export default async function Page({ params }) { return <ReaderChapter {...await params} />; }
```

`/books` is now a reading site. To serve images that sit next to chapters, add `createAgentHandler()` in `proxy.ts` or the `assetRoute()` handler; see [Images → Serving them](./docs/images.md#serving-them).

Any other React app: pass the catalogue to the provider and render chapters as children.

```tsx
import { BookShelf, Reader, ReaderProvider } from "zreader/react";
import "zreader/styles.css";

<ReaderProvider books={books}>
  <BookShelf />
  <Reader book="guide" chapter="intro"><Intro /></Reader>
</ReaderProvider>
```

## Documentation

**Start here**

- [Getting started](./docs/getting-started.md) — install, and the Next.js / React / CMS paths
- [Concepts](./docs/concepts.md) — the catalogue, ids and URLs, block ids, server vs client
- [Architecture](./docs/architecture.md) — the entry points, the browser/server split, how a chapter becomes a page and a `.md` twin
- [Design](./docs/design.md) — why it works this way: anchoring, images, math, storage, offline, and the trade-offs
- [Examples](./examples) — Next.js + shadcn and Vite + shadcn apps

**Build it**

- [React](./docs/react.md) — `ReaderProvider`, the components, the top bar, hooks, Vite, React Router, MDX
- [Next.js](./docs/nextjs.md) — `withReader`, `ReaderRoot`, `ReaderChapter`, static params, deployment
- [Content layer](./docs/content.md) — `content/books/**`, `book.json`, frontmatter, ordering, drafts, the content API
- [Configuration](./docs/configuration.md) — `reader.config.ts`: every option, bookshelves, validation
- [Styling](./docs/styling.md) — `styles.css` vs `tailwind.css`, theme tokens, themes
- [Reader features](./docs/reader-features.md) — highlights, notes, bookmarks, progress, scratchpad, settings, backup, storage
- [Formats: Markdown, MDX, HTML, PDF](./docs/formats.md) — what each format does in the reader and in its `.md` twin
- [Images](./docs/images.md) — files next to chapters, URLs, base64, sizes, `next/image`, the viewer, covers
- [Math](./docs/math.md) — KaTeX, Temml or MathJax in chapters, and math in the scratchpad
- [Runnable code](./docs/sandbox.md) — Python, JavaScript and TypeScript readers run in the scratchpad, permissions, self-hosting Pyodide

**Make it agent-readable**

- [Agent-readable content](./docs/agent.md) — `.md` twins, bookshelves, plugins, `createAgentHandler()` in any server
- [Agent plugins](./docs/plugins.md) — the built-ins, and how to write your own
- [Copy Reference](./docs/copy-reference.md) — the Copy reference button, Open in ChatGPT / Claude / Grok

**Reference**

- [API reference](./docs/api-reference.md) — every entry point and its exports
- [Troubleshooting](./docs/troubleshooting.md) — common errors and how to fix them
- [Production checklist](./docs/production-checklist.md) — what to verify before shipping, and when upgrading to 0.4

## Requirements

React 19 or later. Node 20.9 or later for the server entry points (`zreader/content`, `zreader/agent`, `zreader/next`). Next.js 15.5 or later for the Next.js adapter. Math needs `katex` (0.16+), `temml` (0.11+) or `@mathjax/src` (4+), whichever you choose.

## License

MIT © Alchemyst AI
