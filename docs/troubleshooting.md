# Troubleshooting

## Build fails: `Module not found: Can't resolve '@tiptap/…'` or `"useEditor" is not exported by "__vite-optional-peer-dep:@tiptap/react:zreader"`

The scratchpad editor is lazy-loaded, but bundlers still resolve its imports at build time. Install the Tiptap packages, even if the scratchpad is disabled:

```sh
npm i @tiptap/react @tiptap/pm @tiptap/core @tiptap/starter-kit @tiptap/extension-list @tiptap/extensions @tiptap/markdown
```

## `zreader: no book with id "…" in <ReaderProvider books>`

The id isn't in the catalogue. The message lists the known ids. Check the folder name (book id) and the file name without its number prefix (chapter id). If the message says the component "needs the catalogue", pass `books` to the provider, or use `ReaderRoot` in Next.js.

## `zreader: book "…" has no chapter "…"`

Same, for a chapter id. Drafts (`draft: true`) are hidden outside development.

## `Invalid reader config (reader.config.ts): …`

`withReader` validates the config at startup. Each line names the option and the problem; see [Configuration](./configuration.md).

## `Invalid chapter frontmatter` / `Invalid book.json` / `Duplicate chapter id`

A `ContentError` with the file path. With the default schema every chapter needs a `title`. Duplicate ids come from two files with the same name after the number prefix is removed (`01-intro.md` and `02-intro.md`, or the same name in two subfolders).

## `ContentError: Failed to compile chapter`

Usually invalid MDX. MDX isn't HTML: use `{/* comment */}` instead of `<!-- comment -->`, close every tag (`<br />`), and escape `{`, `}` and `<` in text.

## `zreader: wrap your tree in <ReaderProvider>` / `useReaderChapter() must be used inside <Reader>`

A component or hook is rendered outside its provider. In Next.js, `ReaderRoot` goes in `app/books/layout.tsx` so every page under `/books` is inside it.

## A server-only import fails in the browser

`zreader/content`, `zreader/agent`, `zreader/virtual-config` and `zreader/next/server` resolve to a stub that throws in browser bundles. Move the call to a server component, a loader, or a build script.

## `.md` URLs return the HTML page or a 404

- **Next.js:** check that `proxy.ts` (Next 16) or `middleware.ts` (Next 15.5, with `runtime: "nodejs"`) exists at the project root (or in `src/`), and that its `matcher` matches `reader.basePath`. With `basePath: "/read"`, the matcher is `["/read/:path*.md", "/read.md", "/llms.txt"]`.
- **Other frameworks:** the handler must run before your router or static file server. A `books/:book/:chapter` route also matches `intro.md`.
- A Markdown 404 (`# Not found`) means the handler ran but the book or chapter doesn't exist. Ids are case-sensitive, and drafts are 404 in production.
- PDFs and other non-chapter files never have a twin. See [Formats](./formats.md#pdf).

## `.md` URLs 404 or are empty after deploying

The handler reads `content/books/**` at runtime, so the files must be deployed with the server.

- **Next.js with webpack:** `withReader` adds them to the proxy's file trace.
- **Next.js with Turbopack** (the default in Next 16): Next.js doesn't apply tracing includes to the proxy. `next start` and `output: "standalone"` work, but a host that deploys the proxy as a separate function may not include the files. Build with `next build --webpack`, or check the `.md` URLs after each deploy.
- **Other servers:** include the content folder in your deploy.

## Links in the `.md` twins point at `http://0.0.0.0:…` or the wrong host

Pass `origin` to the handler: `createAgentHandler({ origin: "https://press.example.com" })`. Without it the handler trusts `X-Forwarded-Host` / `Host`, which a misconfigured proxy may not set.

## Copy reference copies a URL that 404s

`markdown` (or `<ReaderRoot agent>`) references `.md` twins. If nothing serves them, drop `markdown` so the button copies the page URL, or set up [the handler](./agent.md).

## Copy reference says "Could not copy"

The Clipboard API needs a secure context (`https` or `localhost`) and, in some browsers, a user gesture. Embedded iframes need `allow="clipboard-write"`.

## Highlights aren't drawn

Highlights are painted with the CSS Custom Highlight API. In browsers without it, the reader shows a notice; highlights are still saved and listed under Contents → Highlights.

## Highlights are "unplaced" after editing a chapter

The quoted passage changed too much to find. The highlight is kept and listed; readers can delete it or keep it as a note. Small edits (typos, added paragraphs) re-anchor automatically.

## Highlights, bookmarks or progress disappeared

- Reader data is per browser and per origin: another browser, device, domain or port has its own data.
- Clearing site data removes it. Export a backup (Settings → Your data).
- Renaming a book folder or chapter file changes its id, which detaches the saved data.
- Changing `storagePrefix` starts from empty storage.

## The phone shows the desktop layout

Add `<meta name="viewport" content="width=device-width, initial-scale=1">` to your HTML (Vite, plain HTML). Next.js adds it automatically.

## Console: "Encountered a script tag while rendering React component"

Logged once in client-only React apps, from `next-themes`' anti-flash script. Harmless. To avoid it, render your own theme setup and pass `manageTheme={false}`.

## Styles are missing or the reader looks unstyled

Import exactly one stylesheet: `zreader/styles.css` without Tailwind, or `@import "zreader/tailwind.css";` after `@import "tailwindcss";` with Tailwind v4. With Tailwind, the package's `@source` lines must stay in place so its classes are generated.
