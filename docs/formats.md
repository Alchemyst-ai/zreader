# Formats: Markdown, MDX, HTML and PDF

A chapter is shown in two places: the **reader page**, which renders the chapter, and its **`.md` twin** (from [`zreader/agent`](./agent.md)), which converts the chapter's source. They are produced separately, so the same file can look different in each. This page lists what survives where.

## Summary

| Format | Is a chapter? | Reader page | `.md` twin |
| --- | --- | --- | --- |
| `.md` | Yes | Rendered as GFM, inline HTML sanitized | The file as written |
| `.mdx` (content layer) | Yes | Compiled and run as code (not sanitized) | Cleaned-up Markdown |
| `.mdx` imported by your bundler | Only if also in `content/books/` | Rendered by your bundler | Only if the same file is in `content/books/` |
| `.html` | Yes | Sanitized | Converted to GFM |
| `.pdf` | **No**, never | Not shown (link to it instead) | No twin; links to it are kept |

## Markdown (`.md`)

**Reader page**

- GFM: tables, task lists, strikethrough, autolinks, footnotes.
- With [`content.math`](./math.md), `$…$`, `$$…$$` and ```` ```math ```` blocks render as MathML.
- Inline HTML is parsed, then the whole output is sanitized (see [Content layer → Security](./content.md#security)).
- Headings get slug ids; `h2`–`h3` go into the chapter's contents list.

**`.md` twin**

- The source as written, minus frontmatter. Raw inline HTML is passed through unchanged.
- `# <title>` from frontmatter is added unless the chapter already has an H1. Code blocks containing `# …` lines don't count as headings.
- Previous / contents / next links are appended.

## MDX (`.mdx`) through the content layer

**Reader page:** compiled with `@mdx-js/mdx` at build time and run on the server. Components come from `mdxComponents` (`{ Callout, RunnableCode }`) plus the `components` you pass to `ReaderChapter`. MDX is code: it is not sanitized, so `<iframe>`, `<video>` or any component renders as written.

**`.md` twin:** the source is parsed as MDX and every MDX-only construct is replaced with its Markdown equivalent, or removed:

| In the source | Reader page | `.md` twin |
| --- | --- | --- |
| Markdown, code blocks, tables, task lists | Rendered | Kept |
| JSX inside a code block | Shown as code | Kept as code |
| `import` / `export` lines | Run | Removed |
| `{expressions}`, `{/* comments */}` | Evaluated | Removed, with any text they would produce. `## Version {v}` → `## Version`; `a {x} b` → `a b` |
| `$…$`, `$$…$$` math | With [`content.math`](./math.md): MathML. Without it, braces inside are still parsed as expressions | Kept as TeX, braces included |
| `<Callout title="Note">…</Callout>` (one line or many) | `Callout` component | A blockquote: `> **Note**` then the content |
| Other components with children (`<Tabs>`, `<Steps>`, `<Kbd>`, `<details>`) | Your component | Replaced by their children. Props and attributes are dropped (`<Tabs label="Pick one">` loses "Pick one") |
| Self-closing components (`<Chart data={…} />`, `<Badge />`) | Your component | Removed entirely: anything they render has no Markdown source |
| `<img src alt title>` | Image | `![alt](src "title")` |
| `<a href>…</a>` | Link | `[…](href)` |
| `<br />` | Line break | Line break |
| `<embed>`, `<iframe>`, `<object>`, `<video>`, `<audio>`, `<source>` with `src` (`data` for `<object>`) | Rendered | A link to the file, labelled with its `title` or file name: `[white paper.pdf](/files/white%20paper.pdf)` |
| Invalid MDX, e.g. an HTML comment `<!-- -->` | **Fails to compile**: the build (or page) errors with the file path | The raw source, unconverted |

If a component carries content agents need (a diagram's caption, a table generated from data), also write it as Markdown in the chapter. Otherwise the twin won't have it.

## MDX rendered directly

`<Reader><Intro /></Reader>`, where your bundler compiles `intro.mdx`:

- **Reader page:** works as usual. Block ids are added in the browser, or at build time with `rehypeBlocks` from `zreader/rehype`. Highlights, notes, bookmarks and progress all work.
- **`.md` twin:** zreader never sees your bundle. The handler can only convert files under `content/books/**`, so there's a twin only when the same file lives there (e.g. you import from `content/books/` with `import.meta.glob`). Otherwise use `<CopyReference />` without `markdown`.

## HTML (`.html`)

**Reader page:** sanitized with DOMPurify. Removed: scripts, event handlers, `javascript:` URLs, inline styles, `<style>`, forms, `<object>`, `<embed>`, inline `<svg>` (unless `sanitize.svg`), MathML (unless [math](./math.md) is on), and iframes except allow-listed `https` hosts. With math on, `\(…\)`, `\[…\]` and `$$…$$` are rendered. Frontmatter at the top of the file works as in Markdown.

**`.md` twin:** converted with rehype-remark to GFM:

- Headings, paragraphs, emphasis, lists, links, images, tables and code blocks (with their language from `class="language-…"`) are converted.
- Scripts and styles are dropped.
- `<embed>`, `<iframe>` and `<object>` become links to their files.
- `<math>` with a TeX annotation becomes `$tex$` / `$$tex$$`.
- Layout-only markup (`<div>`, `<span>`) is unwrapped.

## PDF

zreader reads text chapters only. **A PDF is never a chapter**: there is no PDF viewer, and no text is extracted from PDFs.

### A PDF in `content/books/<book>/`

It is skipped:

- not in the catalogue (`getBooks()`, `<BookShelf>`, contents pages);
- no reader page;
- no `.md` twin: `/books/<book>/<name>.md` returns the Markdown 404.

Widening `loader.pattern` (e.g. `**/*`) doesn't change that: files of unknown formats are skipped. Keeping a PDF next to its chapters is harmless.

### Linking to a PDF

```md
[Download the specification (PDF)](/files/spec.pdf)
```

Works in every format. The reader shows the link, and the `.md` twin keeps it, so an agent reading the twin can fetch the PDF itself. Serve the file from your app (`public/files/spec.pdf` in Next.js and Vite). Relative links resolve the same from the page and from its twin, because both sit in the same folder (`/books/<book>/`).

### Embedding a PDF

| Where | Result |
| --- | --- |
| `.md` / `.html` chapter: `<embed>` or `<object>` | Always removed by the sanitizer |
| `.md` / `.html` chapter: `<iframe src="/files/spec.pdf">` | Removed: iframes need an `https` host listed in `sanitize.allowIframes`, and a same-site path has no host. Link to it instead |
| `.md` / `.html` chapter: `<iframe src="https://cdn.example.com/spec.pdf">` with `allowIframes: ["cdn.example.com"]` | Rendered, sandboxed and lazy-loaded |
| MDX, or `<Reader>` children: `<iframe src="/files/spec.pdf" />` | Rendered (not sanitized) |

An embedded PDF is opaque to the reader:

- no highlights, notes or bookmarks inside it (they need text blocks in the page);
- no entries in the chapter's contents list;
- reading progress only tracks how far the page has scrolled past the frame, not how far into the PDF someone has read;
- in the `.md` twin, an MDX `<iframe>`/`<embed>` becomes a link to the PDF, never its text.

### Making a PDF readable

To get highlights, progress, search by agents and a real `.md` twin, **convert the PDF to Markdown** and add it as a chapter (`03-specification.md`). Keep the PDF as a download link if readers need the original layout.

## Images and other assets

- Images in Markdown (`![alt](./images/x.png)`), HTML and MDX render in the reader from files next to the chapter, URLs or base64 data URIs. See [Images](./images.md) for the rules, sizes, captions and the viewer.
- Relative paths are rewritten to `{basePath}/{book}/_assets/{hash}/…` and served by zreader. Root-relative URLs (`/img/x.png`) are left for your `public/` folder.
- In the `.md` twin, images stay as Markdown images. `.md` twins keep the source as written, so a relative path there is relative to the chapter file, not to the asset URL.
