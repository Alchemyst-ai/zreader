# What's new in zreader 0.4.0

zreader is a React library for publishing books and long-form technical writing on the web: chapters written in Markdown, MDX or HTML, read in a reader that keeps every highlight, note and experiment in the reader's own browser. Version 0.4.0 makes those pages interactive: chapters carry images and math, and readers can run, edit and keep the code in them, with no server.

## The problem it solves

### For developers and publishers

Building a good reading experience usually means stitching together a Markdown pipeline, an annotation layer, a notes editor, a math renderer, image handling, and some way to make code examples runnable, then keeping all of it consistent across every book. Each piece has its own storage, its own markup and its own edge cases.

zreader is one library for all of it:

- **Content stays as files you already edit.** Books are folders of `.md`, `.mdx` and `.html`, with images next to the chapters. There's no CMS schema to learn and no export step: change a file and the page changes.
- **One provider and three components.** `ReaderProvider`, `BookShelf`, `BookContents` and `Reader` give you a full reading site from a plain catalogue, on Next.js, Vite, React Router, Remix or TanStack.
- **Interactive content without custom plumbing.** A fenced block marked `run` becomes code readers can execute. TeX becomes MathML at build time. Images are measured, captioned and served with immutable URLs. You write the content; zreader turns it into the interactive page.
- **Nothing to host for readers' data.** Highlights, notes, pads and progress live in the browser, so there are no accounts, databases or sync services to run. Readers export and import their own backups.
- **Opt-in by design.** Math, runnable code, offline reading and agent plugins each cost nothing until you turn them on, and each is limited in `reader.config.ts`, per site or per shelf.

### For readers and researchers

Reading technical material is rarely just reading. You highlight a claim, jot a note, try the formula, run the example with your own numbers, and come back a week later to find where you were. Usually that means a reader, a notes app, a notebook and a terminal, and copying between them.

In a zreader book it happens in one place:

- **Highlight and annotate** any sentence, formula or code block, with notes that keep the TeX when you copy or quote them.
- **A scratchpad per chapter, per book and across all books**, with checklists, math, images you paste in, and passages quoted straight from the text with a link back.
- **Run the examples where you read them.** Press Run on an author's Python or JavaScript, change it, run it again, and copy it with its output into your notes when it's worth keeping.
- **Experiment in your notes like a notebook.** Python, JavaScript and TypeScript in the scratchpad keep their variables between runs, show plots from Matplotlib, and save the output with the pad, as ordinary Markdown you can export.
- **Your work is private and yours.** Nothing leaves your browser. Code you run can't read your notes or reach the internet unless the site allows it. Back up everything, images included, as one file.

## New in 0.4.0

### Runnable code

- **In your scratchpad:** insert runnable code from the toolbar, choose Python, JavaScript or TypeScript, and run it with Run or Shift+Enter. Variables carry over between runs in the same pad, the last expression's value is shown, and top-level `await` works.
- **In chapters:** authors write ```` ```python run ```` in Markdown or MDX, or use `<RunnableCode>` in MDX, with an optional `output` fence for the expected result. Readers run, edit and reset the code, and copy it into their pad. Examples on a page share variables.
- **Plots and images:** NumPy, pandas and Matplotlib work out of the box. Open figures are shown under the code, and JavaScript can `display()` a canvas. Images are kept with the reader's other images.
- **Safe by default:** code runs in a sandboxed iframe in the reader's browser, with no access to the page, the reader's data or the network. Site owners grant network origins and Python packages in `reader.config.ts`; readers and book files can't.
- **Stored as Markdown:** pads keep code and its output as fenced blocks, so exported notes read like a notebook anywhere. Agents reading the `.md` twin of a chapter see plain code fences.
- **Configurable:** turn it on with `<ScratchpadSandbox />`, choose which pads and whether chapters get it, and set idle and run timeouts per site or per shelf. Pyodide loads from a CDN on first use, or from your own host.

See [Runnable code](./docs/sandbox.md).

### Images

Images next to chapters, from URLs or as base64, in all three formats. They're measured at build time, lazy-loaded, captioned, served with content-hashed URLs, and rendered through `next/image` under Next.js. A full-screen viewer adds pinch, wheel and double-tap zoom. Book covers appear on the shelf. See [Images](./docs/images.md).

### Math

`content.math: "katex" | "temml" | "mathjax"` renders TeX as MathML at build time, so readers download no math JavaScript or fonts. Highlights and quotes keep the TeX, and `<ScratchpadMath />` renders formulas in the scratchpad with click-to-edit. See [Math](./docs/math.md).

### Reader images

Readers paste, drop or insert images into their scratchpads and highlight notes. Images are stored in the browser (IndexedDB), included in backups, and cleaned up when no longer used.

### Offline reading

With `reader.offline.enabled`, readers save a whole book, images included, and read it without a connection.

## Everything else zreader does

- **Sentence highlights** in up to six colours, with notes, a list per book, and anchors that survive edits to the chapter.
- **Bookmarks** on any block, **reading progress** that resumes where you left off, and **reading settings** for theme, text size, line spacing, line width and font.
- **A content layer** for `content/books/**`: frontmatter schemas, ordering, parts, drafts and DOMPurify sanitizing, plus a Next.js adapter that generates every page statically.
- **Bookshelves:** several independent readers on one site, each with its own route, content and plugins.
- **For agents:** a Markdown twin of every shelf, book and chapter, plus opt-in `llms.txt`, frontmatter, CORS and a stateless MCP server, and a Copy reference button for ChatGPT, Claude and Grok.
- **A mobile-first UI** on shadcn/ui, with a precompiled stylesheet or your own Tailwind v4 tokens.

## Upgrading from 0.3

Most sites need one change: add the `_assets` route for images next to chapters. The full list is in the [changelog](./CHANGELOG.md#migrating-to-04) and the [production checklist](./docs/production-checklist.md).

## Get started

```sh
npm i zreader
```

Then follow [Getting started](./docs/getting-started.md), or copy one of the runnable apps in [`examples/`](./examples).
