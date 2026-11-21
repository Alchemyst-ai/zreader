# zreader documentation

zreader is a localStorage-first, mobile-first book reader for React. Readers get bookmarks, reading progress, sentence highlights with notes, a Markdown scratchpad and reading settings. All reader data stays in the browser. An optional content layer, Next.js adapter and agent layer turn a folder of Markdown, MDX and HTML files into a full reading site that AI agents can read too.

## Start here

| If you want to… | Read |
| --- | --- |
| Get a reader running in Next.js or React | [Getting started](./getting-started.md) |
| Understand how the pieces fit | [Concepts](./concepts.md), then [Architecture](./architecture.md) and [Design](./design.md) |
| Start from a working app | [`examples/`](../examples): Next.js + shadcn and Vite + shadcn |
| Ship it | [Production checklist](./production-checklist.md) |

## Guides

| Guide | Covers |
| --- | --- |
| [Content layer](./content.md) | `content/books/**`, `book.json`, frontmatter, ordering, drafts, caching, the content API |
| [Configuration](./configuration.md) | Every option in `reader.config.ts`, defaults, validation |
| [React](./react.md) | `ReaderProvider`, the components, the top bar, hooks, Vite, React Router, MDX |
| [Next.js](./nextjs.md) | `withReader`, `ReaderRoot`, `ReaderChapter`, static params, deployment |
| [Reader features](./reader-features.md) | Highlights, notes, bookmarks, progress, scratchpad, reader images, offline reading, settings, backup, storage |
| [Agent-readable content](./agent.md) | `.md` twins of every page, bookshelves, the plugin system, `createAgentHandler()` in any server |
| [Agent plugins](./plugins.md) | The built-ins (`llms.txt`, MCP, CORS…), the pipeline, and how to write your own |
| [Copy Reference](./copy-reference.md) | The "Copy reference" button, Open in ChatGPT / Claude / Grok, `<MarkdownAlternate>` |
| [Formats: Markdown, MDX, HTML, PDF](./formats.md) | What each format does in the reader and in its `.md` twin |
| [Math](./math.md) | TeX math with KaTeX, Temml or MathJax, rendered as MathML |
| [Images](./images.md) | Images next to chapters, URLs and base64, sizes, `next/image`, captions, the viewer, covers |
| [Styling](./styling.md) | `styles.css` vs `tailwind.css`, theme tokens, themes |

## Reference

| Page | Covers |
| --- | --- |
| [Architecture](./architecture.md) | Entry points, the browser/server split, config resolution, the request and render pipelines, storage, the build |
| [Design](./design.md) | The decisions behind anchoring, images, math, storage, offline reading and agents, and their trade-offs |
| [API reference](./api-reference.md) | Every entry point and its exports |
| [Troubleshooting](./troubleshooting.md) | Common errors and how to fix them |
| [Production checklist](./production-checklist.md) | What to check before shipping, and when upgrading to 0.4 |
| [Glossary](../GLOSSARY.md) | The domain terms used across code, docs and issues |
| [Architecture decision records](./adr/) | One file per hard-to-reverse decision, with the trade-off behind it |

## Entry points at a glance

| Import | Runs in | What it is |
| --- | --- | --- |
| `zreader/react` | Browser (React 19) | `ReaderProvider`, `BookShelf`, `BookContents`, `Reader`, hooks |
| `zreader/editor` | Browser | The Tiptap scratchpad editor (lazy-loaded by `zreader/react`) |
| `zreader` | Anywhere | Core: storage store, anchoring, block ids, backup |
| `zreader/rehype` | Build time | `rehypeBlocks` for your own MDX/Markdown pipeline |
| `zreader/sw` | Anywhere | The offline-reading service worker script |
| `zreader/math/katex`, `zreader/math/temml` | Browser | Math in the scratchpad |
| `zreader/content` | Node | Content layer for `content/books/**` |
| `zreader/config` | Node | `defineConfig`, `glob`, `z` for `reader.config.ts` |
| `zreader/next` | Node (`next.config`) | `withReader()` |
| `zreader/next/client` | Browser | `NextReaderProvider` (provider bound to `next/link`) |
| `zreader/next/server` | Server components | `ReaderRoot`, `ReaderChapter`, `getBookParams`, `getChapterParams` |
| `zreader/agent` | Node | `createAgentHandler()` and the Markdown converters |
| `zreader/plugins/agent` | Node | Opt-in agent plugins: `frontmatter`, `llmsTxt`, `notFound`, `cors`, `mcp`, `disable` |
| `zreader/agent/react` | Browser | `CopyReference`, `MarkdownAlternate` and URL helpers |
| `zreader/styles.css`, `zreader/tailwind.css`, `zreader/reader.css` | CSS | Stylesheets |

Requirements: React 19 or later, Node 20.9 or later for the server entry points, and Next.js 15.5 or later for the Next.js adapter.
