# Changelog

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
