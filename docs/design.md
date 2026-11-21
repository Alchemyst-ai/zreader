# Design

Why zreader works the way it does. [Architecture](./architecture.md) describes the structure; this page records the decisions behind it and what each one costs, so a change can be weighed against the reason it was made.

## Principles

1. **Reader data belongs to the reader.** Highlights, notes, progress, scratchpads and the images in them live in the browser. No account, no server writes. The cost is that data doesn't follow a reader between devices, so backup and restore are first-class.
2. **Content is files.** A book is a folder of Markdown, MDX or HTML. Fixing a typo is an edit, not a re-export, so anchoring has to survive edits.
3. **Everything heavy happens at build time.** Sanitizing, measuring images and typesetting math run when a chapter is compiled, on the server. Readers download HTML and CSS, not parsers or engines.
4. **Every feature past the core is opt-in** and costs nothing when off: math, offline reading, scratchpad math, agent plugins.
5. **Safe by default for content you didn't write.** `.md` and `.html` chapters go through DOMPurify with no inline styles; new features (SVG, MathML, remote images) are added as narrow, configurable exceptions rather than by loosening the defaults. MDX is code and is trusted.

## Anchoring

Highlights are anchored to **block ids** derived from each block's text (`p-3fa9c1`), plus positions and a quote with context. Inserting a paragraph doesn't move other blocks' ids, and a highlight that can't be placed is kept and listed, never deleted.

- The same ids are computed at build time (`rehypeBlocks`) and in the browser (`ensureBlockIds`) from one shared module, so content rendered either way anchors identically.
- **Image-only blocks** (an image alone in a paragraph, a figure without a caption) hash a stand-in text, `Image: <alt or file name>`. That keeps them bookmarkable and resumable without making images highlightable, and replacing the image file doesn't move the bookmark.
- **Math is anchored on its rendered characters**, because that's the text the browser selects. The TeX annotation is excluded from the text index (`data-zr-ignore`) so it isn't counted twice. What a reader sees and takes away is different: `spanToText` rewrites formulas as `$TeX$`, stored as `Highlight.text`. Anchoring and display are deliberately separate fields.

## Images

**Where book images live.** Images next to the chapter (`./images/x.png`) are served by zreader rather than copied into `public/`, so a book folder is self-contained and relative paths work in the editor, in the reader and in the `.md` twin. The alternatives were rejected:

| Option | Why not |
| --- | --- |
| Only `public/` | Splits a book across two folders; relative paths break. Still supported for absolute URLs |
| Copy into `public/` at build time | Writes into the app's folder and only works under Next.js |
| IndexedDB | The image has to reach the browser first, and SSR, crawlers and agents need real URLs. IndexedDB is used for images *readers* add, which never exist on a server |

**Content-hashed URLs** (`/_assets/<hash>/…`) make responses immutable, so the CDN and the browser cache them forever and a changed file gets a new URL. The hash is in the path, not a query string, because `next/image` refuses local URLs with query strings by default.

**Policy in one place.** `rehypeImages` runs after sanitizing in every pipeline and decides what's allowed: remote hosts, data URI types and sizes, relative paths. The sanitizer only removes what's unsafe (script URLs in `srcset`). Images that break the rules are dropped with a warning naming the chapter; the build never fails over an image, because one bad screenshot shouldn't block a release.

**Base64 limits** default to 8 MB per image, with a per-chapter total and a 2 MB development warning. Inline images are part of every page view, twice under React Server Components, so the warning is the real guard.

**`next/image` without becoming a proxy.** Under Next.js, chapters are rendered to React (`htmlToReact`) so `img` can be `next/image`. Only same-origin files and hosts listed in `allowRemote` are optimized; `allowRemote: true` renders other hosts `unoptimized` rather than adding a wildcard to `remotePatterns`, which would let anyone use the site's optimizer for any URL. Remote images aren't measured by default (`probeRemote: false`), so builds need no network; the cost is layout shift unless authors write `width` and `height`.

**The viewer** is built on the Radix Dialog the UI already ships, not a lightbox library, to avoid a dependency for one feature. It uses event delegation, so it works the same for server HTML and React content.

## Math

**MathML from every engine.** KaTeX, Temml and MathJax can all emit MathML, which browsers render natively. That means no engine CSS or fonts to ship, and the sanitizer never has to allow `style` attributes. It's also why math is rendered *after* sanitizing: engine output is trusted, author MathML is still sanitized (with DOMPurify's MathML profile, only when math is on).

**Opt-in, engine chosen by the site.** `content.math` is `false` by default, and each engine is an optional peer dependency loaded with `import()`. The imports carry bundler-ignore comments: without them Turbopack resolves all three at build time and fails unless every engine is installed.

**`remark-math` before MDX.** In MDX, `{…}` is a JavaScript expression, so `$\frac{a}{b}$` used to crash a page. Parsing math first makes the braces TeX.

**HTML chapters use `\(…\)`, `\[…\]` and `$$…$$`, not single `$`.** Prose uses dollar signs for prices; a false positive in a sanitized HTML document is worse than asking authors for unambiguous delimiters.

**Scratchpad math is a separate, browser-side opt-in.** Chapters are typeset on the server, but the pad is edited in the browser, so it needs an engine in the page. A server-side config can't hand the browser a module, so it's turned on with a component (`<ScratchpadMath />`) or a provider prop, and the engine loads only when a pad shows a formula. MathJax isn't offered there: it's too large to send to every reader, so MathJax sites use Temml in the pad and accept small visual differences.

**Pad formulas are sized for notes, not for typesetting.** Inline pad formulas render in display style and the pad matches the math font's x-height to its text (`font-size-adjust`). In a 14px sans pad, TeX inline style shrank `\frac{1}{n^2}` to 60% of a capital letter. Chapters keep standard TeX sizing, where compact inline fractions are the expected look.

**Each scratchpad editor has its own Markdown parser.** Tiptap's Markdown extension registers tokenizers on a shared `marked` instance by default, so the pad's math rules would have changed every other Tiptap editor on the page, silently deleting `$…$` text in an app's own editor. A private `marked` instance per editor costs one dependency.

## Storage

Three stores, each for the kind of data it handles well: `localStorage` for small records (synchronous, tab sync through `storage` events), IndexedDB for images readers add (binary, large, content-hash ids so duplicates are stored once), and the Cache API for saved books. Records never embed binary data; they refer to images as `zr-blob:<id>`, which keeps localStorage small and lets garbage collection find unreferenced images by scanning text.

**Backups stay compatible.** A backup embeds the images its records refer to as base64 (format v2). A backup without images is still written as v1, so older readers can import it. IndexedDB rows hold an `ArrayBuffer` rather than a `Blob`, because storing Blobs is unreliable in some engines.

## Offline reading

Opt-in, because a service worker is site-wide machinery with real failure modes. The worker caches only what a reader explicitly saves.

- **Pages and `/_next/` files are network first.** Next.js reuses chunk file names across builds, so serving them cache-first could run an old build's JavaScript against new pages. Online readers always get the current deploy; the saved copy is refreshed as they read and used only when offline.
- **Only `_assets` is cache first**, because zreader controls those URLs and they change whenever the file does.
- Removing a book deletes only the files no other saved book uses.

## Agents

Every page has a `.md` twin produced from the **source**, not the rendered HTML, so agents get the author's Markdown and TeX rather than a lossy HTML-to-Markdown round trip. Everything past the twins is a plugin scoped to one shelf, so a site opts into each surface (`llms.txt`, MCP, CORS) deliberately. The same handler serves book images, so one proxy matcher covers a shelf.

## Things we chose not to do

- **No EPUB or PDF rendering.** zreader is for books that live as files you edit. PDFs can be linked or embedded but aren't chapters.
- **No sync service.** Reader data stays local; backups move it.
- **No inline styles in sanitized content**, even for math or SVG. Features that need them are done another way (MathML) or limited to MDX.
- **No math engine in the browser by default.** Chapter math costs readers nothing; pad math is a choice the site makes.

## Further reading

- [Architecture](./architecture.md) — entry points, boundaries and pipelines
- [Images](./images.md), [Math](./math.md), [Reader features](./reader-features.md) — behaviour in detail
- [Production checklist](./production-checklist.md) — what to verify before shipping
