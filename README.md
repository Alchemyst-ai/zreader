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
# optional: the scratchpad editor
npm i @tiptap/react @tiptap/pm @tiptap/core @tiptap/starter-kit @tiptap/extension-list @tiptap/extensions @tiptap/markdown
```

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
| `zreader/styles.css` | — | Precompiled stylesheet for apps without Tailwind |
| `zreader/tailwind.css` | — | For Tailwind v4 + shadcn apps; your own theme tokens apply |

A build check makes sure the `react`, `editor`, `rehype` and core bundles never import Next.js or Node built-ins.

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

`useReaderChapter()` returns `{ book, chapter }` inside a `<Reader>`.

## Rendering MDX directly

Pass the chapter as children: an MDX component from your bundler, JSX, or anything else.

```tsx
import Intro from "./books/guide/intro.mdx";

<Reader book="guide" chapter="intro"><Intro /></Reader>
```

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

- `ReaderRoot` reads `config.reader` from `reader.config.ts` and loads every book. It takes the provider's props except `Link`; pass `books` to override the catalogue.
- `ReaderChapter` accepts extra MDX `components`, a per-chapter `header`, and any `<Reader>` prop.
- To use your own catalogue instead of the content layer, render `NextReaderProvider` from `next/client` yourself.

`withReader` does the following:

- Validates `reader.config.*` at startup.
- Aliases it for Turbopack and webpack.
- Keeps jsdom and DOMPurify external.
- Traces the content directory into the server output.
- Caches compiled chapters in `.next/cache/zreader`.

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
