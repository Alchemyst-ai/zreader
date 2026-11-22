# zreader documentation

zreader is a localStorage-first, mobile-first book reader for React. Readers get bookmarks, reading progress, sentence highlights with notes, a Markdown scratchpad and reading settings. All reader data stays in the browser. An optional content layer, Next.js adapter and agent layer turn a folder of Markdown, MDX and HTML files into a full reading site that AI agents can read too.

## Start here

| If you want to… | Read |
| --- | --- |
| Get a reader running in Next.js or React | [Getting started](./getting-started.md) |
| Understand how the pieces fit | [Concepts](./concepts.md), then [Architecture](./architecture.md) and [Design](./design.md) |
| Start from a working app | [`examples/`](../examples): Next.js + shadcn and Vite + shadcn |
| Ship it | [Production checklist](./production-checklist.md) |

## What's new in 0.4

Chapters became interactive. The full story is in [What's new](../WHATS_NEW.md), and every change, with the migration table, is in the [changelog](../CHANGELOG.md#040).

| Feature | In short | Read |
| --- | --- | --- |
| **Runnable code** | Python, JavaScript and TypeScript run in the reader's browser, in a sandboxed iframe, notebook-style, with plots. In scratchpads, and in chapters with ```` ```python run ```` fences | [Runnable code](./sandbox.md), [ADRs](./adr/) |
| **Images** | Files next to chapters, URLs and base64: measured, captioned, lazy-loaded, content-hashed URLs, `next/image`, a full-screen viewer, book covers | [Images](./images.md) |
| **Math** | TeX rendered as MathML at build time with KaTeX, Temml or MathJax; highlights keep the TeX; formulas in the scratchpad | [Math](./math.md) |
| **Reader images** | Images pasted into pads and notes, kept in IndexedDB and included in backups | [Reader features](./reader-features.md#reader-images) |
| **Offline reading** | Save a whole book, images included | [Reader features](./reader-features.md#offline-reading) |

Upgrading from 0.3: most sites only add the `_assets` route. See the [production checklist](./production-checklist.md).

## What's next

Planned work, tracked as GitHub issues. None of it is released yet, and names may change.

| Work | What it adds | Issues | Decided in |
| --- | --- | --- | --- |
| **Per-chapter permissions** | Network and package grants matched by `bookId/chapterId` (`ml-book/*`, `ml-book/ch-7`), most specific rule wins. Until then, chapter code runs with the scratchpad's permissions | [#19](https://github.com/Alchemyst-ai/zreader/issues/19) | [ADR 0004](./adr/0004-permission-rules-match-ids-most-specific-wins.md) |
| **Pinned chapter packages** | Author code gets packages pinned to exact wheel URLs at build time, with the frame's CSP narrowed to those URLs | [#20](https://github.com/Alchemyst-ai/zreader/issues/20) | [ADR 0005](./adr/0005-chapter-packages-pinned-and-csp-enforced.md) |
| **Server Sandbox** | A `Sandbox` class and endpoint the app mounts, with `authorize` and `onRunEnd` callbacks, and a pad scope or chapters set to `"server"` | [#16](https://github.com/Alchemyst-ai/zreader/issues/16), [#22](https://github.com/Alchemyst-ai/zreader/issues/22), [#24](https://github.com/Alchemyst-ai/zreader/issues/24), [#27](https://github.com/Alchemyst-ai/zreader/issues/27), [#28](https://github.com/Alchemyst-ai/zreader/issues/28) | [ADR 0001](./adr/0001-browser-sandbox-by-default.md), [ADR 0006](./adr/0006-server-sandbox-auth-is-the-apps-job.md) |
| **Server backends** | `local()` for development (no isolation, refuses production by default), `daytona()` and `modal()` | [#23](https://github.com/Alchemyst-ai/zreader/issues/23), [#25](https://github.com/Alchemyst-ai/zreader/issues/25), [#26](https://github.com/Alchemyst-ai/zreader/issues/26) | — |
| **Interactive Plotly** | Plotly figures drawn interactively under the code, in their own sandboxed frame, opt-in | [#32](https://github.com/Alchemyst-ai/zreader/issues/32) | — |

## Optional dependencies

zreader installs what every site needs. Everything else is an **optional peer dependency**: install it only for the feature that uses it. zreader loads each one with `import()` only when that feature runs, so a site without it still builds.

| Package | Install it when | How it's used |
| --- | --- | --- |
| `react`, `react-dom` (19+) | You use any React entry point (almost every site) | Optional only so the core and server entry points can be used without React |
| `next` (15.5+) | You use the Next.js adapter (`zreader/next*`) | `withReader`, `ReaderRoot`, `ReaderChapter`, `next/image` for chapter images |
| `@tiptap/react`, `@tiptap/pm`, `@tiptap/core`, `@tiptap/starter-kit`, `@tiptap/extension-list`, `@tiptap/extensions`, `@tiptap/markdown` (3.x) | You show the scratchpad (on by default) | `zreader/editor`, lazy-loaded when a pad opens. Bundlers still resolve it at build time, so install all of them |
| `katex` (0.16+) | `content.math: "katex"`, or scratchpad math from `zreader/math/katex` | Chapter math on the server, pad math in the browser. See [Math](./math.md) |
| `temml` (0.11+) | `content.math: "temml"`, or scratchpad math from `zreader/math/temml` | As above |
| `@mathjax/src` (4+) | `content.math: "mathjax"` | Chapter math on the server only. Pads use Temml instead ([why](./design.md#math)) |
| **`sucrase`** (3.35+) | Readers or authors should run **TypeScript** | Strips types on the reader's page before the code runs as JavaScript. Pass a loader so it's code-split: `<ScratchpadSandbox typescript={() => import("sucrase")} />`. Without it, TypeScript isn't offered and `ts run` fences show as plain code. See [Runnable code](./sandbox.md#languages) |

Two things that look optional but aren't packages you install:

- **`acorn`** is a regular dependency, but it is code-split: the browser downloads it on the first JavaScript or TypeScript run.
- **Pyodide** (the Python runtime) isn't an npm dependency at all. The Python Kernel downloads it from jsDelivr on its first run, or from your own host with `pyodideIndexURL` (copy the `pyodide` npm package at `PYODIDE_VERSION`). See [Self-hosting Pyodide](./sandbox.md#self-hosting-pyodide).

**Planned: server Sandbox providers.** The [server Sandbox](#whats-next) will add two more optional peers, one per paid provider, imported only when a Kernel starts on that backend. They are not in `package.json` yet:

| Package | For | Notes from the spec |
| --- | --- | --- |
| `@daytonaio/sdk` | `daytona()` ([#25](https://github.com/Alchemyst-ai/zreader/issues/25)) | API key from the environment. One Daytona sandbox per server process holds the Kernels and auto-stops when idle. Network grants map to Daytona's network settings |
| `modal` | `modal()` ([#26](https://github.com/Alchemyst-ai/zreader/issues/26)) | Needs **Node 22+**. Token from the environment. Options for `app`, `image`, `cpu` and `memoryMiB`. Network grants map to `outboundDomainAllowlist` |

`local()`, the development backend, will need neither: it runs Python and Node on the server with `child_process`. Both providers run code on infrastructure you pay for, so put the endpoint behind your app's auth ([ADR 0006](./adr/0006-server-sandbox-auth-is-the-apps-job.md)).

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
| [Runnable code](./sandbox.md) | Python, JavaScript and TypeScript readers run in the scratchpad and in chapters, the browser Sandbox, permissions, self-hosting Pyodide |
| [Images](./images.md) | Images next to chapters, URLs and base64, sizes, `next/image`, captions, the viewer, covers |
| [Styling](./styling.md) | `styles.css` vs `tailwind.css`, theme tokens, themes |

## Reference

| Page | Covers |
| --- | --- |
| [Architecture](./architecture.md) | Entry points, the browser/server split, config resolution, the request and render pipelines, storage, the browser Sandbox, the build |
| [Design](./design.md) | The decisions behind anchoring, images, math, runnable code, storage, offline reading and agents, and their trade-offs |
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
| `zreader/sandbox/browser` | Browser | RunnableCode in pads and chapters, run in the reader's browser (`ScratchpadSandbox`, `browserSandbox`) |
| `zreader/content` | Node | Content layer for `content/books/**` |
| `zreader/config` | Node | `defineConfig`, `glob`, `z` for `reader.config.ts` |
| `zreader/next` | Node (`next.config`) | `withReader()` |
| `zreader/next/client` | Browser | `NextReaderProvider` (provider bound to `next/link`) |
| `zreader/next/server` | Server components | `ReaderRoot`, `ReaderChapter`, `getBookParams`, `getChapterParams` |
| `zreader/agent` | Node | `createAgentHandler()` and the Markdown converters |
| `zreader/plugins/agent` | Node | Opt-in agent plugins: `frontmatter`, `llmsTxt`, `notFound`, `cors`, `mcp`, `disable` |
| `zreader/agent/react` | Browser | `CopyReference`, `MarkdownAlternate` and URL helpers |
| `zreader/styles.css`, `zreader/tailwind.css`, `zreader/reader.css` | CSS | Stylesheets |

Requirements: React 19 or later, Node 20.9 or later for the server entry points, and Next.js 15.5 or later for the Next.js adapter. Feature-specific packages are listed under [Optional dependencies](#optional-dependencies).
