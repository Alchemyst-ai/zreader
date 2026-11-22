# Concepts

## The catalogue

Everything in the UI is driven by a **catalogue**: an array of `BookMeta`, passed to `<ReaderProvider books>`. With the catalogue in place, components only need ids (`<Reader book="guide" chapter="intro">`).

```ts
interface BookMeta {
  id: string;
  title: string;
  subtitle?: string;
  authors: string[];
  description?: string;
  cover?: string;          // cover image URL (shelf card and contents page); relative paths in book.json are served as assets
  chapters: ChapterMeta[];  // in reading order
}

interface ChapterMeta {
  id: string;
  title: string;
  order: number;
  description?: string;
  part?: string;    // groups chapters in the contents list, e.g. "Part I · Foundations"
  label?: string;   // eyebrow above the title, e.g. "Chapter 5" or "Appendix A"
  number?: string;  // short list marker, e.g. "5" or "A"
}
```

The catalogue can come from anywhere: a JSON file, a CMS, a fetch, or the [content layer](./content.md) (`getBookMetas()`), which builds it from `content/books/**`. In Next.js, `ReaderRoot` loads it for you.

## Ids and URLs

- A **book id** and a **chapter id** identify a chapter everywhere: in URLs, in storage keys, and in the `.md` twins.
- With the content layer, the book id is the folder name and the chapter id is the file name without its extension and number prefix: `content/books/guide/03-deep-dive.mdx` → book `guide`, chapter `deep-dive`.
- URLs come from **`hrefFor(bookId, chapterId?, hash?)`**. The default is `${basePath}/${bookId}/${chapterId}#hash`, with ids URL-encoded, and `basePath` defaults to `/books`:
  - `/books` is the shelf.
  - `/books/guide` is the book's contents page.
  - `/books/guide/intro` is a chapter.
  - `/books/guide/intro#hl-<id>` links to a highlight.
- Pass your own `hrefFor` to the provider for custom routes (for example `/read/...` or hash routing). Every component, the back button, prev/next links, quote links and the Copy reference button use it.

Changing a book or chapter id changes its URL and orphans the reader's saved highlights, bookmarks and progress for it, because storage is keyed by id.

## Block ids and anchoring

The reader attaches highlights, notes, bookmarks and progress to **blocks**: paragraphs, headings, list items, blockquotes, code blocks, figures, figure captions, table cells and definition list items (`p`, `h1`–`h6`, `li`, `blockquote`, `pre`, `figure`, `figcaption`, `td`, `th`, `dt`, `dd`).

- Each block gets a stable `data-block-id` derived from its tag and text, for example `p-1a2b2e`.
- The content layer adds them at build time (`rehypeBlocks`). Content without ids gets the same ids in the browser, so both paths agree.
- A highlight stores the start block id, offsets, and the quoted text with surrounding context. When the content changes, re-anchoring tries the stored position, then the block's relative offset, then the quote with context, then a fuzzy match. Highlights that can't be placed are kept and listed, never deleted. See [Reader features](./reader-features.md#highlights-and-notes).
- A block with no text of its own (an image alone in a paragraph, a figure without a caption) is identified by its images instead, as `Image: <alt or file name>`. It can be bookmarked and resumed at, but not highlighted. Display math is a `figure` block too.
- Formulas are anchored by their rendered characters; the highlight also stores the passage with formulas as `$TeX$` (`Highlight.text`) for display and quotes.
- Elements with a `data-zr-ignore` attribute (for example `<Callout>`, and TeX annotations inside formulas) are skipped by highlighting.

## Server and client

| Runs on the server / at build time | Runs in the browser |
| --- | --- |
| `zreader/content` (reads files, compiles chapters) | `zreader/react` (all UI) |
| `zreader/agent` (Markdown twins) | `zreader/agent/react` (Copy reference) |
| `zreader/next`, `zreader/next/server` | `zreader/editor` (scratchpad) |
| `zreader/config` | `zreader` core (store, anchoring, blob store) |
| `zreader/sw` (the worker script, served by your server) | `zreader/math/katex`, `zreader/math/temml` (scratchpad math) |
| | `zreader/sandbox/browser` (runnable code in the scratchpad) |
| Image measuring, math typesetting (at compile time) | The image viewer, reader images (IndexedDB), the offline worker |

The server-only entry points resolve to a stub that throws in browser bundles, so importing them from client code fails loudly instead of shipping Node code. A build check keeps `zreader/react`, `zreader/editor`, `zreader/agent/react`, `zreader/rehype` and the core free of Next.js and Node built-ins.

## Where data lives

- **Content** (books and chapters) lives in your app: files, a CMS, anything.
- **Reader data** (settings, highlights, notes, bookmarks, progress, scratchpads) lives in the reader's browser, in `localStorage` under `zr:v1:*`. Nothing is sent to a server. Readers can export and import JSON backups. You can plug in your own storage adapter. See [Reader features](./reader-features.md#storage).

## How configuration reaches the code

- `reader.config.ts` (optional) holds content options (server) and reader options (client). See [Configuration](./configuration.md).
- In Next.js, `withReader()` finds and validates it at startup and aliases `zreader/user-config` to it, so `zreader/content`, `zreader/agent` and `ReaderRoot` all see the same resolved config.
- Outside Next.js (Vite, scripts, tests), `zreader/user-config` falls back to discovering `reader.config.{ts,mts,mjs,js}` in `process.cwd()`. With no file, the defaults apply.
- The client half (`config.reader`) is plain JSON. `ReaderRoot` passes it to the provider; in other frameworks pass it yourself as `<ReaderProvider options>`.
