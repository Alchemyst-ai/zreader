# zreader

A localStorage-first, mobile-first book reader for **React**. Readers get:

- **Bookmarks** and **reading progress**, which resumes where they left off.
- **Sentence highlights**: select text, or switch on highlight mode and tap a sentence. Highlights can carry **notes**.
- A **WYSIWYG Markdown scratchpad** (Tiptap) with checklists. There is a pad per chapter, per book and a global one, and you can quote highlights into it.
- Reading settings (theme, text size, line spacing and width, font) and JSON **backup and restore**.

All reader data stays in the browser. The UI is built from [shadcn/ui](https://ui.shadcn.com) components.

The core only needs React 19 or later. It works with Vite, React Router, TanStack, Remix or Next.js. Next.js gets an **optional adapter**.

```
npm i zreader
# the scratchpad editor: lazy-loaded, but bundlers resolve it at build time, so install it
npm i @tiptap/react @tiptap/pm @tiptap/core @tiptap/starter-kit @tiptap/extension-list @tiptap/extensions @tiptap/markdown
```

**Full documentation: [docs/](./docs/README.md)**: [getting started](./docs/getting-started.md), [concepts](./docs/concepts.md), [content layer](./docs/content.md), [configuration](./docs/configuration.md), [React](./docs/react.md), [Next.js](./docs/nextjs.md), [reader features](./docs/reader-features.md), [agent-readable content](./docs/agent.md), [Copy Reference](./docs/copy-reference.md), [formats (MDX, HTML, PDF)](./docs/formats.md), [styling](./docs/styling.md), [API reference](./docs/api-reference.md), [troubleshooting](./docs/troubleshooting.md).

## Entry points

| Import | Depends on | What it is |
| --- | --- | --- |
| `zreader/react` | React | `ReaderProvider`, `BookShelf`, `BookContents`, `Reader`, hooks |
| `zreader/editor` | React, Tiptap | The scratchpad editor. The React layer lazy-loads it |
| `zreader` | — | Core: storage store, anchoring, block ids, backup |
| `zreader/rehype` | — | `rehypeBlocks` for any MDX/Markdown bundler, so block ids exist before the page loads |
| `zreader/content` | Node | Optional content layer for `content/books/**` (Markdown, MDX, HTML) |
| `zreader/config` | — | `defineConfig`, `glob`, `z` |
| `zreader/next` | Next.js | Optional adapter: `withReader()` for `next.config` |
| `zreader/next/client` | Next.js | Optional adapter: `NextReaderProvider` (provider with `next/link`) |
| `zreader/next/server` | Next.js | Optional adapter: `ReaderRoot`, `ReaderChapter`, `getBookParams`, `getChapterParams`, `mdxComponents` |
| `zreader/agent` | Node | Agent-readable Markdown: `createAgentHandler()` serves `.md` twins of every page and `/llms.txt` |
| `zreader/agent/react` | React | `<CopyReference />`: copy a prompt for an AI agent, or open the page in ChatGPT, Claude or Grok |
| `zreader/styles.css` | — | Precompiled stylesheet for apps without Tailwind |
| `zreader/tailwind.css` | — | For Tailwind v4 + shadcn apps; your own theme tokens apply |

A build check makes sure the `react`, `editor`, `agent/react`, `rehype` and core bundles never import Next.js or Node built-ins.

## The provider

Everything renders under one `ReaderProvider`. It holds the reader's storage, theme and options, plus the **catalogue** of books. With the catalogue in place, the shelf, contents and reader components only need ids.

```tsx
import { ReaderProvider } from "zreader/react";
import "zreader/styles.css";

const books = [
  {
    id: "guide",
    title: "The Guide",
    authors: ["A. Writer"],
    chapters: [
      { id: "intro", title: "Introduction", order: 1 },
      { id: "setup", title: "Setup", order: 2, part: "Part I", label: "Chapter 2" },
    ],
  },
];

<ReaderProvider
  books={books}                        // the catalogue (BookMeta[]): from JSON, a CMS, a fetch, /content…
  Link={RouterLink}                    // any router's link; defaults to <a>
  hrefFor={(book, chapter, hash) => …} // defaults to `${basePath}/${book}/${chapter}#hash`
  headerSlot={<Logo />}                // middle of the reader's top bar (optional)
  options={{ basePath: "/read", highlightColors: ["yellow", "green"] }}
>
  …
</ReaderProvider>
```

| Component | Needs | Renders |
| --- | --- | --- |
| `<BookShelf />` | the provider's `books` | Grid of book cards |
| `<BookContents book="guide" />` | a book id (or `BookMeta`) | A book's contents page: continue card and chapters grouped by `part` (alias: `BookHome`) |
| `<ContinueReading book="guide" />`, `<ChapterList book="guide" />` | a book id | The pieces of the contents page |
| `<Reader book="guide" chapter="intro">…</Reader>` | ids, plus the chapter as children (or `html`) | The full reader |

Props always override the provider: `Link`, `hrefFor`, `books`, `header`. `embedded` drops the full-page shell, so the shelf and contents page can sit inside your own layout. An unknown id throws an error that lists the ids it knows.

### The reader's top bar

The middle of the top bar takes any content. Set a default on the provider (`headerSlot`) or override it per chapter (`header`). It can be:

- a **string**, shown as text;
- an **element**, such as your logo or a description;
- a **function** of `{ book, chapter }`.

`<ReaderTitle />` is the default book-over-chapter title, so you can combine it with your own content:

```tsx
<ReaderProvider books={books} headerSlot={<><Logo /><ReaderTitle /></>}>
<Reader book="guide" chapter="intro" header={({ chapter }) => `Now reading: ${chapter.title}`}>…</Reader>
```

`useReaderChapter()` returns `{ book, chapter, href }` inside a `<Reader>`.

Buttons on the right of the top bar, before the bookmark toggle, work the same way: set a default for every chapter on the provider (`readerActions`), or per chapter with `actions`. A chapter's `actions` replaces the provider's, and `actions={null}` hides them.

```tsx
<ReaderProvider books={books} readerActions={<CopyReference />}>
<Reader book="guide" chapter="intro" actions={null}>…</Reader>
```

## Rendering MDX directly

Pass the chapter as children: an MDX component from your bundler, JSX, or anything else.

```tsx
import Intro from "./books/guide/intro.mdx";

<Reader book="guide" chapter="intro"><Intro /></Reader>
```

For what happens to components, expressions and embedded files (such as PDFs) in the reader and in `.md` twins, see [MDX, HTML and PDF: what to expect](#mdx-html-and-pdf-what-to-expect).

Highlights, notes, bookmarks and progress anchor to **block ids**. If the content has none, `<Reader>` adds them in the browser, using exactly the ids the build-time plugin would produce. With no `toc` prop, the chapter's contents list comes from its `h2`/`h3` headings.

To have the ids in the HTML from the first paint, add the plugin to your MDX pipeline:

```ts
// vite.config.ts
import mdx from "@mdx-js/rollup";
import { rehypeBlocks } from "zreader/rehype";
export default { plugins: [mdx({ rehypePlugins: [rehypeBlocks] })] };
```

## Plain React (Vite)

```tsx
import { BookShelf, BookContents, Reader, ReaderProvider } from "zreader/react";
import Intro from "./books/guide/intro.mdx";

export function App() {
  return (
    <ReaderProvider books={books} hrefFor={(b, c) => (c ? `#/read/${b}/${c}` : `#/read/${b}`)}>
      <BookShelf />
      <BookContents book="guide" />
      <Reader book="guide" chapter="intro"><Intro /></Reader>
    </ReaderProvider>
  );
}
```

## React Router

```tsx
import { Link, Route, Routes, useParams } from "react-router";

function BookPage() {
  return <BookContents book={useParams().book!} />;
}
function ChapterPage() {
  const { book, chapter } = useParams();
  const Chapter = chapters[`${book}/${chapter}`]; // e.g. import.meta.glob("./books/**/*.mdx", { eager: true })
  return <Reader book={book!} chapter={chapter!}><Chapter /></Reader>;
}

<ReaderProvider books={books} Link={({ href, ...p }) => <Link to={href} {...p} />} hrefFor={(b, c) => (c ? `/read/${b}/${c}` : `/read/${b}`)}>
  <Routes>
    <Route path="/read" element={<BookShelf />} />
    <Route path="/read/:book" element={<BookPage />} />
    <Route path="/read/:book/:chapter" element={<ChapterPage />} />
  </Routes>
</ReaderProvider>
```

## Next.js (optional adapter)

The adapter loads the catalogue on the server, binds `next/link`, and compiles chapters from `content/books/**`. In Next.js, `next/link` has to come from a `"use client"` module; `NextReaderProvider` is that module.

```ts
// next.config.ts
import { withReader } from "zreader/next";
export default withReader({ reactStrictMode: true });
```

```tsx
// app/books/layout.tsx — provider with the whole catalogue and next/link
import { ReaderRoot } from "zreader/next/server";
import "zreader/styles.css";
export default function Layout({ children }) {
  return <ReaderRoot headerSlot={<YourLogo />}>{children}</ReaderRoot>;
}

// app/books/page.tsx
import { BookShelf } from "zreader/react";
export default function Page() { return <BookShelf />; }

// app/books/[book]/page.tsx
import { BookContents } from "zreader/react";
import { getBookParams } from "zreader/next/server";
export const generateStaticParams = getBookParams;
export default async function Page({ params }) { return <BookContents book={(await params).book} />; }

// app/books/[book]/[chapter]/page.tsx — compiles Markdown/MDX/HTML and renders <Reader>
import { getChapterParams, ReaderChapter } from "zreader/next/server";
export const generateStaticParams = getChapterParams;
export default async function Page({ params }) { return <ReaderChapter {...await params} />; }
```

- `ReaderRoot` reads `config.reader` from `reader.config.ts` and loads every book. It takes the provider's props except `Link` (including `headerSlot` and `readerActions`); pass `books` to override the catalogue, and `agent` for [agent-readable content](#agent-readable-content-optional).
- `ReaderChapter` accepts extra MDX `components`, a per-chapter `header`, and any `<Reader>` prop.
- To use your own catalogue instead of the content layer, render `NextReaderProvider` from `next/client` yourself.

`withReader` does the following:

- Validates `reader.config.*` at startup.
- Aliases it for Turbopack and webpack.
- Keeps jsdom and DOMPurify external.
- Traces the content directory into the server output.
- Caches compiled chapters in `.next/cache/zreader`.
- Traces the content directory into the proxy too, for `zreader/agent` (webpack builds; see the note below).

> **Turbopack note.** Turbopack does not apply `outputFileTracingIncludes` to the proxy. `next start` and `output: "standalone"` still work, because the page traces include the content directory. On hosts that deploy the proxy as its own function, check that `.md` URLs resolve after deploying.

## Content layer (optional, Node)

```
content/books/<book-id>/
  book.json            { "title", "subtitle"?, "authors"?, "description"?, "chapters"?: [ids] }
  01-introduction.md   frontmatter: title, description?, part?, label?, number?, order?, draft?
  02-deep-dive.mdx     trusted MDX: compiled at build time, may use components
  03-appendix.html     raw HTML, sanitized with DOMPurify
```

- `getBookMetas()` returns plain `BookMeta[]`, ready for `<ReaderProvider books>` in any framework.
- `getChapter()` and `renderChapter()` compile one chapter. `renderMarkdown()` and `renderHtml()` handle content from other sources.

**Security.** Markdown, inline HTML in Markdown, and `.html` chapters are all sanitized with DOMPurify. That removes scripts, event handlers, `javascript:` URLs, inline styles, forms, and iframes unless you allow them. **MDX is code**: compile only MDX files you trust and author yourself.

## Agent-readable content (optional)

`zreader/agent` gives every reader page a Markdown twin for LLMs, agents and crawlers, using the content layer (`content/books/**`):

| URL | Returns |
| --- | --- |
| `/books/<book>/<chapter>.md` | The chapter as Markdown, with previous / contents / next links |
| `/books/<book>.md` | The book's description and table of contents |
| `/books.md` | Every book on the shelf |
| `/llms.txt` | An [llms.txt](https://llmstxt.org) index of every chapter |

Markdown chapters are served as written, MDX chapters are cleaned up, and HTML chapters are converted to GFM; see [MDX, HTML and PDF: what to expect](#mdx-html-and-pdf-what-to-expect). The URLs follow `reader.basePath`.

`createAgentHandler()` takes a `Request` and returns a `Response`, or `undefined` for any other path. In Next.js (15.5 or later), call it from the proxy:

```ts
// proxy.ts (Next 16). On Next 15.5, name it middleware.ts, export `middleware`, and add runtime: "nodejs" to config.
import { NextResponse } from "next/server";
import { createAgentHandler } from "zreader/agent";

const agent = createAgentHandler({ origin: "https://press.example.com" });
export async function proxy(req: Request) {
  return (await agent(req)) ?? NextResponse.next();
}
export const config = { matcher: ["/books/:path*.md", "/books.md", "/llms.txt"] };
```

> **Keep the matcher in sync with `reader.basePath`.** Next.js reads `matcher` from the file at build time, so it must be a literal; it can't be imported. If you change `basePath` to `/read`, change the matcher to `["/read/:path*.md", "/read.md", "/llms.txt"]` by hand, or every `.md` URL returns 404.

Options: `origin` (absolute origin for links; defaults to the `X-Forwarded-Host` / `Host` header, so set it in production), `basePath`, `api` (e.g. a `defineBooks()` content source), `llms` (`false`, or `{ title, description }`), `cacheControl`. Any server that speaks `Request`/`Response` works the same way, such as a React Router resource route or Hono. The converters (`chapterToMarkdown`, `bookToMarkdown`, `shelfToMarkdown`, `llmsTxt`, `mdxToMarkdown`, `htmlToMarkdown`) are exported too.

### Copy Reference

`<CopyReference />` from `zreader/agent/react` is a split button for the reader's top bar:

- The button copies `Refer the content at <url>`.
- The menu copies the URL alone, or opens ChatGPT, Claude or Grok with `Read from <url> so I can ask questions about it.`

In Next.js, turn on the agent features for every chapter with one flag on `ReaderRoot`:

```tsx
// app/books/layout.tsx
<ReaderRoot agent>{children}</ReaderRoot>
// or customise it (plain values only: built-in providers, strings)
<ReaderRoot agent={{ prompt: "Use {url} as context", providers: ["chatgpt", "claude"], label: "Cite" }}>{children}</ReaderRoot>
```

`agent` adds `<CopyReference markdown />` to the top bar of every chapter, plus a `<link rel="alternate" type="text/markdown">` tag in `<head>` (`<MarkdownAlternate />`) so agents and crawlers can find the Markdown twin. Any `readerActions` you pass render after the agent button. It's off by default, because it only works once `proxy.ts` serves the `.md` URLs.

Anywhere else, render the components yourself:

```tsx
import { CopyReference, MarkdownAlternate } from "zreader/agent/react";

<ReaderProvider books={books} readerActions={<><MarkdownAlternate /><CopyReference markdown /></>}>
```

| Prop | Default | |
| --- | --- | --- |
| `markdown` | `false` | Reference the page's `.md` twin. Leave it off unless you serve `createAgentHandler()`. A function maps page URLs to Markdown URLs yourself |
| `prompt` | `"Refer the content at {url}"` | The copied text |
| `askPrompt` | `"Read from {url} so I can ask questions about it."` | The prompt sent to the assistants |
| `providers` | `["chatgpt", "claude", "grok"]` | Built-in ids, or `{ id, label, href(prompt) }`. `[]` hides them |
| `label` | `"Copy reference"` | Button text (shown from the `lg` breakpoint) |

The URL is built from the reader's `hrefFor` and `location.origin` when clicked, so it works with custom routes. `markdownUrl`, `formatPrompt` and `providerUrl` are exported for your own buttons.

### Starter: Next.js

Chapters live in `content/books/<book>/`. Four files, then every chapter has a `.md` twin, a `<link rel="alternate">` tag and a Copy reference button.

```ts
// next.config.ts
import { withReader } from "zreader/next";
export default withReader({});
```

```ts
// proxy.ts (Next 16). Next 15.5: middleware.ts, export `middleware`, add runtime: "nodejs" to config.
import { NextResponse } from "next/server";
import { createAgentHandler } from "zreader/agent";

const agent = createAgentHandler({ origin: "https://press.example.com" });

export async function proxy(req: Request) {
  return (await agent(req)) ?? NextResponse.next();
}
export const config = { matcher: ["/books/:path*.md", "/books.md", "/llms.txt"] };
```

```tsx
// app/books/layout.tsx
import { ReaderRoot } from "zreader/next/server";
import "zreader/styles.css";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <ReaderRoot agent>{children}</ReaderRoot>;
}
```

```tsx
// app/books/[book]/[chapter]/page.tsx
import { getChapterParams, ReaderChapter } from "zreader/next/server";

export const generateStaticParams = getChapterParams;

export default async function Page({ params }: { params: Promise<{ book: string; chapter: string }> }) {
  return <ReaderChapter {...await params} />;
}
```

Result, for `content/books/context-infra/02-appendix-a-api-endpoint-reference.mdx`:

- `/books/context-infra/appendix-a-api-endpoint-reference` is the reader page.
- `/books/context-infra/appendix-a-api-endpoint-reference.md` is its Markdown twin.
- **Copy reference** copies `Refer the content at https://press.example.com/books/context-infra/appendix-a-api-endpoint-reference.md`.

### Starter: React (Vite)

There's no adapter, so you serve the `.md` URLs from your server and add the buttons on the provider. With Vite, a small plugin covers `vite dev` and `vite preview`; in production, put the same handler in front of your static files (Express, Hono, a worker, …).

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

```tsx
// src/main.tsx
import { createRoot } from "react-dom/client";
import { BookShelf, Reader, ReaderProvider } from "zreader/react";
import { CopyReference, MarkdownAlternate } from "zreader/agent/react";
import "zreader/styles.css";
import { books, chapters } from "./books"; // your catalogue (BookMeta[]) and chapter components

function App() {
  const [, , book, chapter] = window.location.pathname.split("/"); // /books/:book/:chapter
  const Chapter = chapters[`${book}/${chapter}`];
  return (
    <ReaderProvider books={books} readerActions={<><MarkdownAlternate /><CopyReference markdown /></>}>
      {Chapter ? <Reader book={book!} chapter={chapter!}><Chapter /></Reader> : <BookShelf />}
    </ReaderProvider>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
```

- The handler reads `content/books/**` from disk (and `reader.config.ts` if there is one), so the `.md` twins exist only for chapters in the content layer. Keep the chapters you render and the content folder the same files, e.g. `import.meta.glob("../content/books/**/*.mdx")`.
- **No server at all** (static hosting only): there is nothing to answer `.md` requests. Use `<CopyReference />` without `markdown`, so it copies the page URL, and skip `<MarkdownAlternate />`. Or point `markdown` at Markdown you host elsewhere: `markdown={(pageUrl) => …}`.
- With hash routing (`#/read/…`), `.md` URLs can't be derived from the page URL; use the `markdown` function form.

### MDX, HTML and PDF: what to expect

The reader page and the `.md` twin are produced separately: the page renders the chapter, the twin converts its source. What survives in each:

**Markdown (`.md`)**

- Reader: rendered as GFM; inline HTML is sanitized (see Security above).
- `.md` twin: the file as written, minus frontmatter. A `# Title` from the frontmatter is added unless the chapter already has an H1.

**MDX (`.mdx`), through the content layer**

| In the source | Reader page | `.md` twin |
| --- | --- | --- |
| Markdown, code blocks, tables, task lists | Rendered | Kept |
| `import` / `export` lines | Run (MDX is code) | Removed |
| `{expressions}`, `{/* comments */}` | Evaluated | Removed, along with any text they would produce (`## Version {v}` becomes `## Version`) |
| `<Callout title="Note">…</Callout>` | The `Callout` component | A blockquote with a bold title |
| Other components with children (`<Tabs>`, `<Steps>`, `<Kbd>`) | Your component | Replaced by their children; props and string attributes are dropped |
| Self-closing components (`<Chart data={…} />`) | Your component | Removed entirely: anything they render has no Markdown equivalent |
| `<img src alt>`, `<a href>`, `<br />` | Rendered | Image, link and line break |
| `<embed>`, `<iframe>`, `<object>`, `<video>`, `<audio>` with a `src`/`data` | Rendered (MDX is not sanitized) | A link to the file, labelled with its `title` or file name, e.g. `[white paper.pdf](/files/white%20paper.pdf)` |
| Invalid MDX (e.g. an HTML comment `<!-- -->`) | Fails to compile: the build or page errors | The raw source, unconverted |

If a component carries content agents need (a diagram's caption, a table built from data), also write it as Markdown in the chapter, or the `.md` twin won't have it.

**MDX rendered directly** (`<Reader><Intro /></Reader>`, imported by your bundler)

- Reader: works as usual. Block ids, highlights, notes and progress are added in the browser (or at build time with `rehypeBlocks`).
- `.md` twin: only if the same file is also under `content/books/**`; the handler converts that file. Otherwise there is no twin, so use `<CopyReference />` without `markdown`.

**HTML (`.html`)**

- Reader: sanitized with DOMPurify (scripts, styles, forms, `<object>` and `<embed>` removed; iframes only from `https` hosts in `sanitize.allowIframes`).
- `.md` twin: converted to GFM. Scripts and styles are dropped; `<embed>`, `<iframe>` and `<object>` become links to their files.

**PDF**

zreader reads text chapters only; a PDF is never a chapter.

- **A `.pdf` in `content/books/<book>/`** is ignored: it isn't in the catalogue, has no reader page and no `.md` twin (`…/whitepaper.md` returns 404). Widening `loader.pattern` doesn't change that; files of unknown formats are skipped.
- **Linking to a PDF** (`[Download the spec](/files/spec.pdf)`) works everywhere: the reader shows the link, and the `.md` twin keeps it, so an agent can fetch the PDF itself. Serve the file from your app (e.g. `public/files/`). Relative links resolve the same from the page and from its `.md` twin.
- **Embedding a PDF**:
  - In `.md` and `.html` chapters, `<embed>` and `<object>` are always removed, and `<iframe>` needs an allow-listed `https` host, so a same-site `/files/spec.pdf` can't be embedded. Link to it instead.
  - In MDX, or as children of `<Reader>`, an `<iframe src="/files/spec.pdf">` renders. The PDF is a black box to the reader: no highlights, notes or bookmarks inside it, no table-of-contents entries, and reading progress only tracks how far the page has scrolled past the frame, not how far into the PDF someone has read. The `.md` twin has a link to the PDF, not its text.
- **To make a PDF readable** (highlights, progress, a real `.md` twin), convert it to Markdown and add it as a chapter. Keep the PDF as a download link if readers need the original.

## Styling

- **Without Tailwind**, import `styles.css`. It is compiled and unlayered. Theme tokens are namespaced (`--zr-background`, `--zr-primary`, …, `--zr-font-serif`), so you can override them in your own CSS. A scoped reset keeps your site's global element styles out of the reader.
- **With Tailwind v4 + shadcn**, use `@import "zreader/tailwind.css";` instead. Your own tokens then style the reader.
- **Themes.** `next-themes`, a plain React library despite the name, sets `light`, `dark` or `sepia` on `<html>` and prevents a flash on load. If you already render a `ThemeProvider`, pass `manageTheme={false}`.

## Storage

Keys are namespaced as `zr:v1:*`, and each record is versioned with forward migrations. Corrupt records are dropped item by item, tabs stay in sync, writes are flushed when the page is hidden, and quota errors go to `onStorageError`. `exportBackup` and `importBackup` merge by id, and the most recently updated record wins. You can supply your own `StorageAdapter`, for example IndexedDB.

## Highlights

- **Anchors** use W3C-style quote and position selectors, so highlights survive edits to the content. When a passage moves, re-anchoring falls back in order: stored position, then the block's relative offset, then the quote with surrounding context, then a fuzzy match.
- **Painting** uses the CSS Custom Highlight API, so the DOM is never mutated.
- **Unplaced highlights** are kept and listed in the panel rather than deleted.

## License

MIT © Alchemyst AI
