# Production checklist

Go through this before you ship a zreader site, and again when you upgrade to 0.4. Each item links to the page that explains it.

## Upgrading to 0.4

- [ ] **Serve images next to chapters.** If you use the agent proxy, add `"<basePath>/:book/_assets/:path*"` to the `matcher` in `proxy.ts`, once per shelf. `agentMatcher(shelf)` from `zreader/next/server` lists every entry a shelf needs. Without the proxy, add the `assetRoute()` handler at `app/<shelf>/[book]/%5Fassets/[...path]/route.ts`. See [Images → Serving them](./images.md#serving-them).
- [ ] **Check that an `_assets` URL loads.** Open a chapter with a relative image (`./images/x.png`) and confirm the image request returns `200` with `Cache-Control: public, max-age=31536000, immutable`. A `404` means the matcher or route is missing.
- [ ] **Expect new markup in chapters with images.** Image-only paragraphs and caption-less figures now get block ids, so those chapters get a new `contentHash`. Highlights re-attach by their quoted text as usual. Spot-check a few highlighted chapters after deploying.
- [ ] **Decide on captions.** A lone image with a title (`![Alt](x.png "Title")`) now becomes a `<figure>` with a `<figcaption>`. Set `content.images.captions: false` to keep the old markup.
- [ ] **Clear or warm the compile cache.** The pipeline version changed, so every chapter recompiles once. On hosts that keep `.next/cache`, the first requests after deploy are slower.
- [ ] **Code that builds `ReaderClientOptions` by hand** needs `userImages` and `offline`. `mergeOptions` and `resolveConfig` fill them in.

## Images

- [ ] **Limit remote hosts.** `content.images.allowRemote` is `true` by default (any host). For untrusted or user-submitted content, list the hosts you expect. Listed hosts are also optimized by `next/image`. See [Remote images](./images.md#remote-images).
- [ ] **Decide on remote sizes.** `probeRemote` is `false`, so remote images have no `width`/`height` and the page can shift as they load. Either write `width` and `height` in the chapter, or turn on `probeRemote` and make sure `next build` has network access.
- [ ] **Watch the base64 warnings.** Inline images over `maxDataUriBytes` (8 MB) are dropped with a `[zreader]` warning, and the build doesn't fail. Search your build log for `dropped image`. Chapters over `warnDataUriTotalBytes` (2 MB) are flagged in development: move those images into the book folder. See [Base64 images](./images.md#base64-images).
- [ ] **Search the build log for other dropped images:** paths outside the book folder, symlinks, hidden files and extensions not in `content.assets.extensions`.
- [ ] **If you set `images.localPatterns` in `next.config`**, confirm `withReader` appended your shelves' asset paths (it does when the list exists).
- [ ] **Inline SVG** is removed from `.md` and `.html` chapters unless `sanitize.svg: true`. Turn it on only if you need it.

## Math

- [ ] **Install the engine** you set in `content.math` (`katex`, `temml` or `@mathjax/src`). If it's missing, compiling a chapter with math fails with `npm i <engine>`. See [Math](./math.md).
- [ ] **Check display math delimiters.** `$$` must be on its own lines for display math; `$$x$$` inside a sentence renders inline.
- [ ] **Search the build log for `could not render math`.** Invalid TeX never fails the build; it stays on the page in red.
- [ ] **Scratchpad math (optional):** render `<ScratchpadMath />` from `zreader/math/katex` or `zreader/math/temml` inside `<ReaderRoot>`, with the same `macros` as `content.math`. Sites using MathJax for chapters should use Temml here. Then quote a formula to the pad and type `$x^2$` in it.
- [ ] **Check fonts.** Math uses the browser's MathML font unless you load one and set `--zr-math-font`. Look at a formula-heavy chapter in Chrome, Firefox and Safari.

## Reader images and backups

- [ ] **Set `reader.userImages.maxBytes`** to what you're comfortable keeping in readers' browsers (default 10 MB per image), or turn the feature off with `userImages.enabled: false`.
- [ ] **Try a backup round trip.** Paste an image into the scratchpad and into a note, export a backup, clear site data, import it, and check that both images come back. Backups with images are format v2; older zreader versions can't import them.
- [ ] **Keep the backup reminder on** (`reader.backupReminder`) unless you sync reader data elsewhere. Reader images live only in the browser that stored them.

## Offline reading (if enabled)

- [ ] **Serve the worker from the site root** at `reader.offline.serviceWorker` (default `/zreader-sw.js`), for example with `serviceWorkerRoute()` at `app/zreader-sw.js/route.ts`. It must be served over HTTPS (or `localhost`). See [Offline reading](./reader-features.md#offline-reading).
- [ ] **Test it offline.** Save a book, switch the browser to offline in dev tools, and open the book page and a chapter. Unsaved pages should show the offline notice.
- [ ] **Deploy once with a saved book.** Save a book, deploy a change, and reload it online: you should get the new version (pages and `/_next/` files are network first).
- [ ] **Plan for resets.** Change `cacheName` in `serviceWorkerScript({ cacheName })` to drop every saved book (for example after a breaking change to page markup).

## Runnable code (if enabled)

- [ ] **Decide where it runs.** Turn off pads that shouldn't have it with `reader.sandbox.scopes`, per site or per shelf. See [Runnable code](./sandbox.md).
- [ ] **Know the third-party request.** The first Python run downloads Pyodide (about 10 MB) from `cdn.jsdelivr.net`. To avoid that, self-host it and set `pyodideIndexURL` (served with CORS allowed).
- [ ] **Grant only what books need.** `dangerousPermissions.network` and `packages` are off by default; list exact origins and package names rather than `network: true`.
- [ ] **If you send a Content-Security-Policy,** the Sandbox frame inherits it: allow an inline script, `blob:` workers, `'unsafe-eval'`, `'wasm-unsafe-eval'` and the Pyodide origin, then run Python and JavaScript once.
- [ ] **TypeScript:** install `sucrase` and pass `typescript={() => import("sucrase")}` from a client component.
- [ ] **Run the real-browser check:** `npm run build`, then `node scripts/sandbox-check/run.mjs` and open it in Chrome, Firefox and Safari (including iOS), or `--auto` with Playwright.

## Agents

- [ ] **Set `origin`** in `createAgentHandler({ origin })` so links in `.md` twins and `llms.txt` point at your public domain, not an internal host.
- [ ] **Run with development warnings once.** In `next dev`, open a chapter and its `.md` twin; zreader warns when the proxy matcher misses a shelf.

## Test in real browsers

The automated tests use simulated browser APIs for these, so check them by hand before a release:

- [ ] The image viewer: tap to open, pinch and wheel zoom, double-tap, pan, swipe down and Escape to close, focus returning to the image, on a phone and a desktop.
- [ ] Pasting and dropping images into the scratchpad and into notes, in Chrome, Firefox and Safari (including iOS).
- [ ] Book covers on the shelf and contents page, through `next/image` under Next.js.
- [ ] Offline saving and reading, if enabled.
- [ ] Highlights over math and over figure captions: the Highlights list, Copy and Quote to scratchpad should show `$TeX$`.
- [ ] Formula size in the scratchpad, in the desktop panel and the mobile drawer: an inline `$\frac{1}{n^2}$` should read at the size of the surrounding text. Adjust with `--zr-math-scale` on `.zr-editor` if your pad font differs a lot.
- [ ] Formulas in the scratchpad: typing `$…$` and `$$ `, the Σ button, click to edit, Escape to cancel.
- [ ] RunnableCode, if enabled: Run and Shift+Enter, Stop on an endless loop, a matplotlib plot, and a pad reloaded with its Output, in the desktop panel and the mobile drawer.
