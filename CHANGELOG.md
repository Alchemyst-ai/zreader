# Changelog

## 0.4.0

**Images.** Chapters can show images from files next to the chapter, URLs and base64 data URIs, in `.md`, `.mdx` and `.html`. See [Images](./docs/images.md).

- **Images next to chapters:** `![x](./images/x.png)` is rewritten to `{basePath}/{book}/_assets/{hash}/images/x.png` and served with immutable caching. `createAgentHandler()` serves these URLs. Without the proxy, use `assetRoute()` from `zreader/next/server` or `createAssetHandler()` from `zreader/content`. Refused: paths outside the book folder, symlinks pointing out of it, hidden files, and extensions not in `content.assets.extensions`. SVG is sent with a strict CSP.
- **New `content.images` options:** a remote host allowlist (`allowRemote`) and base64 limits: `maxDataUriBytes` (8 MB), `maxDataUriTotalBytes`, and a 2 MB warning in development. `probeRemote` is off by default. Images that aren't allowed are dropped with a warning that names the chapter.
- **Sizes:** images are measured at compile time (book files, `public/`, base64) and get `width`/`height`, `loading="lazy"` and `decoding="async"`.
- **Responsive images:** `srcset`, `sizes` and `<picture><source>` are kept, and each candidate is checked against the same rules as `src`.
- **Captions:** a lone titled image becomes a `<figure>` with a `<figcaption>`.
- **Next.js:** `ReaderChapter` renders Markdown and HTML chapters as React, so images go through `next/image`. That's optimized for local files and listed hosts, and `unoptimized` for base64, SVG and unlisted hosts. `withReader` adds `allowRemote` hosts to `images.remotePatterns`. Outside Next.js, images stay plain `<img>`, and `ZImage` and `htmlToReact` are available.
- **Viewer:** tapping a block image opens a full-screen view built on Radix Dialog, with pinch, wheel and double-tap zoom, panning, keyboard controls and swipe to close. `content.images.lightbox` and `<Reader lightbox>` turn it off.
- **Bookmarks and progress:** image-only paragraphs and caption-less figures now get block ids, so you can bookmark them and resume reading at them.
- **Covers:** `book.cover` is shown on the shelf and the contents page. A relative cover in `book.json` is served as an asset. Covers render through the provider's new `Image` prop, which `NextReaderProvider` sets to `next/image`.
- **Inline SVG:** opt in with `sanitize.svg: true`.

**Math.** `content.math: "katex" | "temml" | "mathjax"` renders TeX as MathML with the engine you install (an optional peer dependency). It handles `$…$`, `$$…$$` and ```` ```math ```` in Markdown and MDX, and `\(…\)`, `\[…\]` and `$$…$$` in HTML. Display math is its own block. In MDX, braces inside `$…$` are no longer evaluated as JavaScript. MathML you write yourself is kept while math is on. `.md` twins keep the TeX. See [Math](./docs/math.md).

**Math in quotes and the scratchpad.** Highlights over math keep the TeX: the Highlights list, Copy, the highlights export and Quote to scratchpad show `$E=mc^2$` instead of the rendered characters (stored as the new optional `Highlight.text`). Render `<ScratchpadMath />` from the new `zreader/math/katex` or `zreader/math/temml` entries (or pass `<ReaderProvider math>`) and the scratchpad renders `$…$` and `$$…$$`, with click-to-edit, `$x$` and `$$ ` shortcuts and a Σ button. The engine loads only when a pad shows a formula. Inline pad formulas are typeset in display style (`inlineStyle="text"` opts out) and the pad matches the math font's letter height to the text (`--zr-math-x-height`, `--zr-math-scale`), so fractions and sums aren't dwarfed by the text around them; chapter math sizing is unchanged. Each scratchpad editor now has its own Markdown parser, so its extensions never affect other Tiptap editors on the page.

**Reader images.** Readers can paste, drop or insert images into the scratchpad and into highlight notes. The images are stored in IndexedDB as `zr-blob:<id>`, with per-image limits (`reader.userImages`), usage shown in settings, and **Remove unused images**. Backups embed the images (format v2); a backup without images is still written as v1.

**Offline reading (opt-in).** With `reader.offline.enabled`, book pages get **Save for offline**, backed by the service worker from the new `zreader/sw` entry (`serviceWorkerRoute()` in `zreader/next/server`). See [Offline reading](./docs/reader-features.md#offline-reading).

### Migrating to 0.4

See also the [production checklist](./docs/production-checklist.md).

| Change | Migration |
| --- | --- |
| Images next to chapters are served at `{basePath}/:book/_assets/:path*` | Add that entry to the `matcher` in `proxy.ts` (`agentMatcher(shelf)` lists it), or add `assetRoute()` |
| `ReaderChapter` renders Markdown/HTML chapters as React instead of an `html` string | None. `components` now also apply to them by tag name, including `img` |
| Image-only paragraphs and caption-less figures get block ids; `figure` is a block tag | Chapters with images get a new `contentHash`. Highlights re-anchor by their quote as usual |
| A lone image with a title becomes a `<figure>` | Set `content.images.captions: false` to keep the old markup |
| `srcset` is no longer removed | None |
| Compiled-chapter cache version bumped | Chapters recompile once |
| `annotateHtml(html, opts?)` also runs `rehypeImages` | Pass `{ images: false }` to skip it |
| MDX `.md` twins parse `$…$` as math, so braces between dollar signs are kept, not removed | None |
| `ReaderClientOptions` gains `userImages` and `offline` | Only affects code that builds the object by hand; `mergeOptions` and `resolveConfig` fill the defaults |
| `BACKUP_VERSION` is `2` | v1 backups still import |
| `SelectionState.text` (from `useChapterEngine`) writes formulas as `$TeX$` | Use `index.text.slice(start, end)` for the rendered characters |

New dependencies: `image-size`, `remark-math`, `hast-util-to-jsx-runtime`, `unist-util-visit-parents`, `marked` (the same major as `@tiptap/markdown` uses). New optional peers: `katex`, `temml` and `@mathjax/src`.

## 0.3.0

**Bookshelves.** `defineConfig({ bookshelves: [...] })` declares one or more shelves, each with its own content folder, `basePath` and agent plugins. Every zreader surface — the agent handler, `ReaderRoot`, `ReaderChapter`, the static params helpers and `withReader` tracing — reads shelves from the same config. Shelves are never nested: one route each.

**Agent plugins.** New `zreader/plugins/agent`, scoped to the shelf that declares them:

- `frontmatter()` — YAML frontmatter (`title`, `description`, `canonical`, `last_updated`, …) on every document.
- `llmsTxt({ full, root })` — `{basePath}/llms.txt`, `{basePath}/llms-full.txt`, and the site root with `root: true`. One shelf's books only.
- `notFound()` — a 404 document that lists the valid book and chapter ids.
- `cors()` — CORS headers and `OPTIONS` preflights.
- `mcp()` — a stateless MCP server at `POST {basePath}/mcp` with `list_books`, `get_book`, `get_chapter` and `search`.
- `disable(name)` — drop a plugin inherited from the top level.

Plus:

- `getShelf(id?)` and `getShelves()` in `zreader/content`; book caches are per shelf.
- `ReaderRoot shelf`, `ReaderChapter shelf`, `getBookParams(shelf?)`, `getChapterParams(shelf?)` and `agentMatcher(shelf)`.
- `withReader` traces every shelf's content folder.
- Development warnings when a shelf's routes aren't reaching zreader (a stale proxy matcher or a renamed `app/` folder).
- New converters in `zreader/agent`: `fullTextToMarkdown`, `notFoundToMarkdown`, `renderFrontmatter`, `demoteHeadings`, `resolveLastUpdated`, `newestLastUpdated`, `newestBookLastUpdated`.

### Migrating to 0.3

| Change | Migration |
| --- | --- |
| `/llms.txt` is no longer served by default | Add `llmsTxt({ root: true })` to `agent.plugins` |
| The `llms` option of `createAgentHandler` is removed | Use the `llmsTxt()` plugin's options |
| `createAgentHandler({ api, basePath })` is removed | Declare a bookshelf; for non-file content use `sources` |
| `createAgentHandler()` serves every shelf, not just the default content | No change for single-shelf apps |
| `matchAgentRoute(pathname, basePath, llms)` loses `llms`; `{ kind: "llms" }` is gone | Drop the third argument |
| `reader.basePath` at the top level is an error when `bookshelves` is set | Move it to each shelf |
| `ResolvedReaderConfig` gains `shelves` and `defaultShelf` | Only affects code that constructs one by hand (`defineBooks(resolved)`) — add the fields, or use `resolveConfig()` |
| `package.json` `exports` gains `./plugins/agent` | None |

Unchanged for an app with one shelf and no plugins: the `.md` twin bodies are byte-identical to 0.2, storage keys are unchanged, and `ReaderRoot`, `ReaderChapter`, `getBooks()` and friends behave as before.

## 0.2.0

- New `zreader/agent`: `createAgentHandler()` serves agent-readable Markdown twins of every page (`/books/<book>/<chapter>.md`, `/books/<book>.md`, `/books.md`) and `/llms.txt`. MDX is cleaned up and HTML is converted to Markdown.
- New `zreader/agent/react`: `<CopyReference />` copies a prompt that points an AI agent at the current chapter, with a menu to open it in ChatGPT, Claude or Grok.
- In `.md` twins, `<embed>`, `<iframe>`, `<object>`, `<video>` and `<audio>` become links to their files (so linked PDFs stay reachable), `<br />` becomes a line break, and MDX that can't be parsed is served as its raw source instead of failing.
- `<Reader actions>` and the provider's `readerActions` add buttons to the top bar; a chapter's `actions` replaces the provider's, `null` hides them. `useReaderChapter()` also returns `href`.
- `<ReaderRoot agent>` turns on `<CopyReference markdown />` and a `<link rel="alternate" type="text/markdown">` tag (`<MarkdownAlternate />`) for every chapter. `ReaderRoot` also takes `readerActions`.
- `withReader()` traces the content directory into the proxy/middleware (webpack).
- **Breaking:** the Next.js adapter now requires Next.js 15.5 or later.

## 0.1.0

First release.

- A React reader with a shelf, a contents page per book, and a chapter view.
- Bookmarks, reading progress and resume, sentence highlights in six colours with notes.
- A WYSIWYG Markdown scratchpad (Tiptap) per chapter, per book and globally, lazy-loaded from `zreader/editor`.
- Reading settings: theme (light, dark, sepia), text size, line spacing, measure and font.
- All reader data stays in `localStorage` under `zr:v1:*`, with JSON backup and restore.
- The `zreader/rehype` plugin adds block ids at build time; content without ids gets them in the browser.
- An optional content layer (`zreader/content`) for Markdown, MDX and HTML books.
- An optional Next.js adapter (`zreader/next`, `zreader/next/client`, `zreader/next/server`).
- Requires React 19 or later.
