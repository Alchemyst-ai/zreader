# React

`zreader/react` is the whole reader UI. It needs React 19 and nothing else: no Next.js, no Node APIs. It works with Vite, React Router, TanStack, Remix, Next.js, or a plain `<script type="module">` app.

## `ReaderProvider`

Everything renders under one provider. It holds the reader's storage, theme and options, and the catalogue of books.

```tsx
import { ReaderProvider } from "zreader/react";
import "zreader/styles.css";

<ReaderProvider
  books={books}
  Link={RouterLink}
  hrefFor={(book, chapter, hash) => …}
  headerSlot={<Logo />}
  readerActions={<MyButton />}
  options={{ basePath: "/read", highlightColors: ["yellow", "green"] }}
>
  …
</ReaderProvider>
```

| Prop | Type | Default | |
| --- | --- | --- | --- |
| `books` | `BookMeta[]` | `[]` | The [catalogue](./concepts.md#the-catalogue). Lets every component work from ids |
| `Link` | component with `href` | `<a>` | Router link used by every component (`next/link`, a React Router wrapper, …) |
| `hrefFor` | `(bookId, chapterId?, hash?) => string` | `${basePath}/${book}/${chapter}#hash` | URL builder used everywhere |
| `headerSlot` | node, string, or `({ book, chapter }) => node` | `<ReaderTitle />` | Middle of the reader's top bar |
| `readerActions` | node | — | Buttons on the right of the top bar, before the bookmark toggle |
| `options` | partial [reader options](./configuration.md#reader) | defaults | Usually `config.reader` from `reader.config.ts` |
| `overrides` | partial reader options | — | Merged on top of `options` |
| `manageTheme` | boolean | `true` | Render a `next-themes` `ThemeProvider`. Set `false` if your app already has one |
| `toaster` | boolean | `true` | Render a sonner `<Toaster>`. Set `false` if your app already has one |
| `adapter` | `StorageAdapter` | `localStorage` | Custom storage (see [Reader features](./reader-features.md#storage)) |
| `store` | `ReaderStore` | — | Provide your own store (tests, advanced) |
| `onStorageError` | `(error) => void` | `console.warn` | Called on quota and write errors |

Component props always win over the provider: `Link`, `hrefFor`, `books`, `header` and `actions` can be passed per component.

## Components

| Component | Needs | Renders |
| --- | --- | --- |
| `<BookShelf />` | the provider's `books` (or a `books` prop) | A grid of book cards. Props: `title` (default "Books"), `description`, `embedded` |
| `<BookContents book="id" />` | a book id or `BookMeta` | A book's contents page: title, authors, a continue card, chapters grouped by `part`. Props: `backHref`, `backLabel` (default "All books"), `embedded`. Alias: `BookHome` |
| `<ContinueReading book="id" />` | a book id | "Start reading" / "Continue: Chapter 3 · 42%" card |
| `<ChapterList book="id" />` | a book id | Chapter list with read state, grouped by `part` |
| `<Reader book="id" chapter="id">…</Reader>` | ids, plus the chapter content | The full reader (see below) |
| `<ReaderTitle />` | inside `<Reader>` | The default header: book title over chapter title |
| `<Callout title="…">…</Callout>` | — | A note box for MDX chapters; ignored by highlighting |

`embedded` drops the full-page shell (background, padding, title block) so the shelf or contents page can sit inside your own layout.

An unknown id throws an error that lists the ids the provider knows, or explains that the catalogue is missing.

The building blocks (`ContentsSheet`, `HighlightPanel`, `SelectionToolbar`, `SettingsPanel`, `ScratchpadPanel`, `ResponsivePanel`) and the chapter engine (`useChapterEngine`) are exported for custom readers.

## `<Reader>`

```tsx
<Reader book="guide" chapter="intro">
  <Intro />
</Reader>
```

| Prop | Type | |
| --- | --- | --- |
| `book` | id or `BookMeta` | |
| `chapter` | id or `ChapterMeta` | |
| `children` | node | The chapter content: an MDX component, JSX, anything |
| `html` | string | Or: sanitized HTML from `renderChapter()` / `renderMarkdown()` / `renderHtml()` on the server |
| `toc` | `TocEntry[]` | Contents of this chapter. Default: the `h2`/`h3` headings found in the rendered content |
| `contentHash` | string | Identifies the chapter's text for anchoring. Default: computed in the browser |
| `prev`, `next` | `ChapterMeta \| null` | Default: the neighbouring chapters. `null` hides the link |
| `header` | like `headerSlot` | Overrides the provider's header for this chapter |
| `actions` | node | Replaces the provider's `readerActions` for this chapter; `null` hides them |
| `backHref` | string | Where the back button goes. Default: the book's contents page |
| `Link`, `hrefFor` | | Override the provider's |
| `className` | string | |

The reader includes: a sticky top bar (back, contents, header, actions, bookmark, highlight mode, settings, scratchpad), a reading progress bar, the chapter eyebrow (`part` · `label`, or "Chapter N of M") and title, the content, "Mark chapter as read", and previous/next links. On mobile the top bar hides while scrolling down. See [Reader features](./reader-features.md).

### The top bar

The middle of the top bar takes any content: set a default on the provider (`headerSlot`) or per chapter (`header`). It can be a string (shown as text), an element (your logo), or a function of `{ book, chapter }`.

```tsx
<ReaderProvider books={books} headerSlot={<><Logo /><ReaderTitle /></>}>
<Reader book="guide" chapter="intro" header={({ chapter }) => `Now reading: ${chapter.title}`}>…</Reader>
```

Buttons on the right work the same way: `readerActions` on the provider, `actions` per chapter. A chapter's `actions` replaces the provider's; `actions={null}` hides them.

```tsx
import { CopyReference } from "zreader/agent/react";

<ReaderProvider books={books} readerActions={<CopyReference />}>
<Reader book="guide" chapter="secret" actions={null}>…</Reader>
```

Inside `<Reader>`, `useReaderChapter()` returns `{ book, chapter, href }`, where `href(chapterId?, hash?)` builds URLs within the book. Use it in custom header content and actions.

## Hooks

All hooks must be used under `<ReaderProvider>`. Storage-backed hooks return server-safe defaults during SSR and hydration, then the reader's saved data.

| Hook | Returns |
| --- | --- |
| `useReader()` | `{ store, options, library }` |
| `useLibrary()` | `{ books, getBook, Link, href, headerSlot, readerActions }` |
| `useBook(bookOrId)` | `BookMeta` (throws for unknown ids) |
| `useReaderStore()` | The `ReaderStore` |
| `useSettings()` | `[settings, updateSettings]` |
| `useHighlights(bookId, chapterId?)` | `Highlight[]` |
| `useBookmarks(bookId)` | `Bookmark[]` |
| `useProgress(bookId)` | `BookProgress` (per chapter `percent`, `completed`, and the last position) |
| `usePad(scope)` | `Pad` (`{ markdown, updatedAt }`) |
| `useReaderChapter()` | `{ book, chapter, href }` inside `<Reader>` |
| `useHydrated()` | `false` during SSR and hydration, `true` after |
| `useMediaQuery(query, serverValue?)` | boolean |
| `useIsDesktop()` | `true` from 1024px |

Every hook re-renders on changes, including changes made in other tabs.

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

Add `<meta name="viewport" content="width=device-width, initial-scale=1">` to `index.html`.

## React Router

```tsx
import { Link, Route, Routes, useParams } from "react-router";

function BookPage() {
  return <BookContents book={useParams().book!} />;
}
function ChapterPage() {
  const { book, chapter } = useParams();
  const Chapter = chapters[`${book}/${chapter}`]; // e.g. from import.meta.glob("./books/**/*.mdx", { eager: true })
  return <Reader book={book!} chapter={chapter!}><Chapter /></Reader>;
}

<ReaderProvider
  books={books}
  Link={({ href, ...p }) => <Link to={href} {...p} />}
  hrefFor={(b, c) => (c ? `/read/${b}/${c}` : `/read/${b}`)}
>
  <Routes>
    <Route path="/read" element={<BookShelf />} />
    <Route path="/read/:book" element={<BookPage />} />
    <Route path="/read/:book/:chapter" element={<ChapterPage />} />
  </Routes>
</ReaderProvider>
```

## Rendering MDX directly

Pass the chapter as children: an MDX component from your bundler, JSX, or anything else. If the content has no block ids, `<Reader>` adds them in the browser, using exactly the ids the build-time plugin would produce. To have them in the HTML from the first paint, add the plugin to your MDX pipeline:

```ts
// vite.config.ts
import mdx from "@mdx-js/rollup";
import { rehypeBlocks } from "zreader/rehype";

export default { plugins: [mdx({ rehypePlugins: [rehypeBlocks] })] };
```

`rehypeBlocks({ tocDepth: [2, 3] })` controls which heading levels go into the contents list. Pass `{ Callout }` from `zreader/react` in your MDX components to use `<Callout>`.

For what happens to components, expressions and embedded files in the reader and in `.md` twins, see [Formats](./formats.md).

## Rendering HTML from a server

Any server can render Markdown or HTML with `zreader/content` and send the result to the client:

```ts
// server
import { renderMarkdown } from "zreader/content";
const { html, toc, contentHash } = await renderMarkdown(source);
```

```tsx
// client
<Reader book="guide" chapter="intro" html={html} toc={toc} contentHash={contentHash} />
```

## Utilities

| Export | |
| --- | --- |
| `defaultHref(basePath, bookId, chapterId?, hash?)` | The default URL builder |
| `DefaultLink` | The default `<a>` link |
| `groupByPart(chapters)` | Groups consecutive chapters by `part` |
| `chapterMarker(chapter, index)` | The list marker (`number`, else the 1-based position) |
| `copyText(text)`, `downloadFile(name, content, type?)` | Clipboard and download helpers |
| `mergeOptions(base, ...overrides)` | Deep merge for client options |
| `PROSE_CLASS`, `TEXT_SIZE_CLASS`, `LEADING_CLASS`, `MEASURE_CLASS`, `FONT_CLASS`, `SWATCH_CLASS`, … | The Tailwind class maps the reader uses |
