# Content layer

`zreader/content` turns a folder of Markdown, MDX and HTML files into books. It is optional: you can build the catalogue yourself and render chapters any way you like (see [React](./react.md)). It runs on the server or at build time only (Node 20.9+).

## Folder layout

```
content/books/
  context-infra/                     ← book id: "context-infra"
    book.json                        ← book metadata (optional)
    01-intro.md                      ← chapter id: "intro"
    02-appendix-a-api-endpoint-reference.mdx
    03-changelog.html
    images/diagram.png               ← ignored (not a chapter format)
  field-guide/
    book.json
    01-start.md
```

- Every folder directly under the content base is a book. Files sitting at the base itself (not in a book folder) are ignored.
- Chapter files can be nested inside the book folder (`context-infra/part-1/01-intro.md`); the book is always the first folder.
- Chapter formats: `.md` (Markdown), `.mdx` (MDX) and `.html` (HTML). `.markdown` and `.htm` are recognised too, but the default pattern (`**/*.{md,mdx,html}`) doesn't match them; widen `loader.pattern` to include them. Any other file, including PDFs and images, is skipped even if the pattern matches it. See [Formats](./formats.md).
- The base folder is `./content/books` by default. Change it with `content.loader` in [`reader.config.ts`](./configuration.md#content).

## Ids

| Thing | Id comes from | Example |
| --- | --- | --- |
| Book | The folder name | `content/books/context-infra/` → `context-infra` |
| Chapter | The file name, without extension and without a leading number prefix | `02-appendix-a-api-endpoint-reference.mdx` → `appendix-a-api-endpoint-reference` |

The number prefix is digits followed by `-`, `_`, `.` or a space (`01-`, `2_`, `10. `). Two chapters in one book that end up with the same id fail with `Duplicate chapter id "…" in book "…"`.

Ids appear in URLs and in readers' storage keys: renaming a file changes its URL and detaches readers' highlights, bookmarks and progress from it.

## `book.json`

```json
{
  "title": "Context Infrastructure",
  "subtitle": "Build AI that understands your business",
  "authors": ["A. Writer"],
  "description": "A practical guide to context engineering.",
  "cover": "/covers/context-infra.png",
  "chapters": ["intro", "appendix-a-api-endpoint-reference"]
}
```

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `title` | string | — | Required when `book.json` exists |
| `subtitle` | string | — | |
| `authors` | string[] | `[]` | |
| `description` | string | — | Shown on the shelf and used by `/llms.txt` |
| `cover` | string | — | Image URL for the shelf card |
| `chapters` | string[] | — | Explicit chapter order by id (see below) |

Without `book.json`, the title is the folder name in title case (`field-guide` → `Field Guide`). Extra keys are kept and available as `book.data`. Invalid JSON or a failed validation throws a `ContentError` with the file path.

## Chapter frontmatter

```md
---
title: API Endpoint Reference
label: Appendix A
number: A
part: Appendices
description: Every endpoint, with request and response shapes.
order: 99
draft: false
---
```

| Field | Type | Notes |
| --- | --- | --- |
| `title` | string | **Required** by the default schema |
| `description` | string | Shown in chapter lists, `book.md` and `/llms.txt` |
| `part` | string | Groups consecutive chapters under a heading in the contents list |
| `label` | string | Eyebrow above the chapter title (default: "Chapter N of M"); also prefixes the title in `.md` indexes (`Appendix A: API Endpoint Reference`) |
| `number` | string or number | Short marker in lists; stored as a string |
| `order` | number | Sort key (see below) |
| `draft` | boolean | Hidden unless drafts are included |

Frontmatter works in all three formats, including `.html` files. Extra keys are kept as `chapter.data`. A chapter that fails validation throws `Invalid chapter frontmatter` with the field and file path. Replace the schemas to add or require fields; see [Configuration](./configuration.md#schemas).

## Order

Chapters within a book are sorted by, in order of precedence:

1. Position in `book.json` `chapters`. Chapters not listed there come after the listed ones.
2. `order` from frontmatter, else the file name's number prefix (`03-…` → 3). Chapters with neither go last.
3. File path, alphabetically.

Books on the shelf are sorted by title.

## Drafts

`draft: true` hides a chapter. Drafts are included when `content.includeDrafts` is `true`, which is the default when `NODE_ENV` is `development`: drafts show in `next dev` and disappear from production builds.

## The content API

```ts
import { getBooks, getBookMetas, getBook, getChapter, renderChapter, getStaticParams } from "zreader/content";
```

| Function | Returns |
| --- | --- |
| `getBooks()` | `BookEntry[]`: books with full chapter entries (file path, format, frontmatter, raw body) |
| `getBookMetas()` | `BookMeta[]`: plain, serializable catalogue for `<ReaderProvider books>` |
| `getBook(bookId)` | `BookEntry \| null` |
| `getChapter(bookId, chapterId)` | `{ book, chapter, index, prev, next } \| null`; `chapter.body` is the raw source without frontmatter |
| `renderChapter(chapter)` | `{ kind: "html", html, toc, blocks, contentHash }` or `{ kind: "mdx", Content, toc, blocks, contentHash }` |
| `getStaticParams({ book?, chapter? })` | `[{ book, chapter }, …]` for every chapter; param names are configurable |
| `getReaderConfig()` | The resolved config |

- `toc` lists `h2`–`h3` headings (`{ id, depth, text }`), `blocks` lists block ids, and `contentHash` identifies the chapter's text (used by anchoring).
- `Content` is an MDX component: render `<Content components={{ Callout, ...yours }} />`.
- In production, the book list is loaded once per process. In development it is re-read on every call, so edits show on reload.

### More than one content folder

`defineBooks()` creates a separate API with its own content options, merged on top of the global config:

```ts
import { defineBooks, glob } from "zreader/content";

export const handbook = defineBooks({ loader: glob({ base: "./content/handbook" }) });
const books = await handbook.getBooks();
```

Pass the result to the agent handler as `createAgentHandler({ api: handbook })` to serve its `.md` twins.

## Compilation and caching

- **Markdown** goes through remark (GFM), your `remarkPlugins`, remark-rehype, rehype-raw (inline HTML), your `rehypePlugins`, then DOMPurify, then block ids.
- **HTML** goes through DOMPurify, then block ids.
- **MDX** is compiled with `@mdx-js/mdx` (GFM, your plugins, then block ids) to a function body and run on the server. MDX is code and is **not** sanitized.
- Compiled chapters are cached in memory and on disk under `content.cacheDir` (default `node_modules/.cache/zreader`; `withReader` uses `.next/cache/zreader`). The cache key covers the file, its contents, the sanitize options and the plugin names, so edits and config changes recompile. The disk cache is best-effort and silently skipped on read-only file systems.
- A chapter that fails to compile throws `ContentError: Failed to compile chapter: …` with the file path.

## Security

Markdown (including inline HTML) and HTML chapters are sanitized with DOMPurify:

- Removed: scripts, event handlers, `javascript:` URLs, inline `style` attributes, `srcset`, `<style>`, forms and form controls (task-list checkboxes are kept, disabled), `<object>`, `<embed>`, `<base>`, `<link>`, `<meta>`, and any `data-block-id` you wrote yourself.
- Iframes are removed unless their `src` is `https` and its host is listed in `content.sanitize.allowIframes` (subdomains included). Allowed iframes get `sandbox="allow-scripts allow-same-origin allow-presentation"` and `loading="lazy"`.
- Links with `target="_blank"` get `rel="noopener noreferrer"`; other `target` values are removed.
- Extend the allow-list with `sanitize.allowTags` and `sanitize.allowAttributes`.

**MDX is code.** It is compiled and run as JavaScript. Only use MDX files you author and trust; never compile user-supplied MDX.

## Rendering content from elsewhere

The pipelines are exported for content that doesn't live in files (a CMS, a database):

```ts
import { renderMarkdown, renderHtml, compileMdx, runMdx, sanitizeHtml } from "zreader/content";

const { html, toc, contentHash } = await renderMarkdown(markdownFromCms);
// <Reader book="guide" chapter="intro" html={html} toc={toc} contentHash={contentHash} />
```

| Function | Does |
| --- | --- |
| `renderMarkdown(md, opts?)` | Markdown → sanitized HTML with block ids, `toc`, `blocks`, `contentHash` |
| `renderHtml(html, opts?)` | Untrusted HTML → sanitized, annotated HTML |
| `annotateHtml(html)` | Adds block ids and a TOC to already-safe HTML |
| `compileMdx(source, opts?)` / `runMdx(code)` | Trusted MDX → compiled code → component |
| `sanitizeHtml(html, sanitizeOptions?)` | DOMPurify with zreader's rules |

`opts` is `{ sanitize?, remarkPlugins?, rehypePlugins? }`.
