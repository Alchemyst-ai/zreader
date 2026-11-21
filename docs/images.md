# Images

Chapters can show images from three kinds of source:

| Source | Example | Where the file lives |
| --- | --- | --- |
| A file next to the chapter | `![Diagram](./images/diagram.png)` | `content/books/<book>/…`, served by zreader |
| A URL | `![Logo](https://cdn.example.com/logo.png)`, `/img/logo.png` | Anywhere: your `public/` folder, a CDN |
| Inline base64 | `![Dot](data:image/png;base64,iVBORw0…)` | Inside the chapter |

All three work in `.md`, `.mdx` and `.html` chapters, with Markdown image syntax or `<img>`. In MDX, a JSX `<img>` (or `<Image>`) you write yourself is rendered as written: the steps below apply to Markdown image syntax there. Under the Next.js adapter, images render through [`next/image`](#nextjs); everywhere else they are plain `<img>` elements.

## What zreader does with an image

When a chapter is compiled (`rehypeImages`, after sanitizing for `.md` and `.html`):

1. **Checks the source** against [`content.images`](#configuration). Images that aren't allowed are dropped with a `[zreader]` warning that names the chapter. They don't fail the build.
2. **Rewrites relative paths** (`./images/x.png`) to [asset URLs](#images-next-to-chapters).
3. **Measures it** and writes `width` and `height`, so the page doesn't jump as images load. Files next to the chapter, files in `public/` and base64 images are always measured. Remote images are measured only with `probeRemote: true`. An author's own `width` or `height` is kept, and the missing one is filled in from the aspect ratio.
4. **Adds** `loading="lazy"` and `decoding="async"` (`lazy: false` turns this off).
5. **Adds a caption.** An image alone in a paragraph with a title (`![Alt](x.png "The caption")`) becomes a `<figure>` with a `<figcaption>` (`captions: false` turns this off).
6. **Marks it** for CSS and the viewer:
   - `data-zr-image="block"`: alone in a paragraph, figure, link or list item. Shown centred, on its own line.
   - `data-zr-image="inline"`: inside a line of text, such as an icon. It stays in the line.
   - `data-zr-zoom`: a block image that isn't inside a link. Opens the [viewer](#the-viewer). It also gets `tabindex="0"`, so it can be reached with the keyboard.

`srcset`, `sizes` and `<picture><source>` are kept. Each `srcset` candidate is checked against the same rules as `src`.

## Images next to chapters

Keep a book's images inside its folder and reference them relative to the chapter:

```
content/books/physics/
  01-intro.md            ← ![Diagram](./images/diagram.png)
  images/diagram.png
  book.json              ← "cover": "./images/cover.png"
```

zreader rewrites the path to

```
/books/physics/_assets/3f2a9c10de/images/diagram.png
         ↑book   ↑route  ↑content hash
```

and serves it with `Cache-Control: public, max-age=31536000, immutable`. The hash comes from the file's contents, so a changed image gets a new URL and readers never see a stale copy. In development, a changed image is picked up without touching the chapter.

What is served:

- only files inside the book folder (`../` and symlinks that point outside it are refused);
- only the extensions in `content.assets.extensions` (default `png`, `jpg`, `jpeg`, `gif`, `webp`, `avif`, `svg`);
- no hidden files or folders (`.git`, `.env`).

SVG files are sent with `Content-Security-Policy: default-src 'none'; …; sandbox`, so a script inside one never runs. Every response has `X-Content-Type-Options: nosniff`.

### Serving them

**With the agent proxy (Next.js):** `createAgentHandler()` already serves assets. Add the asset route to the matcher, one entry per shelf:

```ts
export const config = {
  matcher: ["/books.md", "/books/:path*.md", "/books/:book/_assets/:path*"],
};
```

`agentMatcher(shelf)` from `zreader/next/server` lists every entry a shelf needs.

**Without the proxy (Next.js):** add a route handler. The folder must be named `%5Fassets`, because Next.js hides folders that start with `_`:

```ts
// app/books/[book]/%5Fassets/[...path]/route.ts
import { assetRoute } from "zreader/next/server";
export const { GET, HEAD } = assetRoute(); // assetRoute("reports") for another shelf
```

**Any other server:** `createAssetHandler()` from `zreader/content` is a `Request → Response` handler. It returns `undefined` for URLs it doesn't own:

```ts
import { createAssetHandler } from "zreader/content";
const assets = createAssetHandler();
// in your server: return (await assets(request)) ?? next();
```

`serveAsset(request, { basePath, assets, bookDir })` is the lower-level version, for content that isn't loaded from `reader.config.ts`.

### Or use `public/`

Root-relative URLs (`/img/x.png`) are left as written. Put the file in your app's `public/` folder and it is served by your framework as usual. zreader still reads it from `public/` to measure it.

## Remote images

Any `http(s)` URL is allowed by default. To limit them, list the hosts (subdomains included):

```ts
content: { images: { allowRemote: ["cdn.example.com", "upload.wikimedia.org"] } }
```

`allowRemote: false` drops every remote image.

Remote images aren't measured unless you turn on `probeRemote`. It fetches the first 128 KB of each image while compiling, so `next build` needs network access. Without it, remote images still render, but the page can shift as they load. To avoid that, give them `width` and `height` yourself:

```html
<img src="https://cdn.example.com/chart.png" width="1200" height="800" alt="Revenue by quarter">
```

## Base64 images

`data:image/*;base64,…` URIs are allowed for PNG, JPEG, GIF, WebP, AVIF, BMP and ICO. SVG data URIs are off unless `allowSvgDataUri: true`.

| Limit | Default | What happens past it |
| --- | --- | --- |
| `maxDataUriBytes` | 8 MB per image (decoded) | The image is dropped with a warning |
| `maxDataUriTotalBytes` | no limit, per chapter | Later images are dropped with a warning |
| `warnDataUriTotalBytes` | 2 MB, per chapter | A warning in development |

Inline images are part of the chapter's HTML, so readers download them again on every page view, with no separate caching. Under React Server Components they are sent twice: once in the HTML and once in the RSC payload. A 4 MB base64 image adds roughly 10 MB to each page load. For anything larger than an icon, put the file [next to the chapter](#images-next-to-chapters) instead.

## Next.js

`<ReaderChapter>` renders Markdown and HTML chapters as React, so every image goes through `next/image`. MDX chapters get the same `img` component. For each image:

| Source | Renders as |
| --- | --- |
| Book assets, `/img/x.png` in `public/` | `next/image`, optimized |
| Remote, host listed in `allowRemote` | `next/image`, optimized (`withReader` adds the hosts to `images.remotePatterns`) |
| Remote with `allowRemote: true` | `next/image`, `unoptimized`. Listing every host in `remotePatterns` would make your optimizer an open proxy. |
| Base64, SVG, local URLs with a query string | `next/image`, `unoptimized` |
| An image with its own `srcset`, or an unresolved relative path | Plain `<img>` |

Images without a known size use `width={0} height={0}` with CSS sizing, so they never crash the page.

If your `next.config` sets `images.localPatterns`, `withReader` appends each shelf's asset path to it. If it doesn't, all local paths are allowed already.

To use your own component, pass it by tag name: `<ReaderChapter components={{ img: MyImage }} />`. It applies to every format. `createReaderImage(content.images)` builds the default one.

Book covers on the shelf and contents pages use `next/image` with `fill` through `NextReaderProvider`.

## Plain React

Outside Next.js, compiled HTML keeps plain `<img>` tags with `width`, `height` and lazy loading. `ZImage` from `zreader/react` is the same element as a component. Pass it to your MDX components, or to `htmlToReact(html, { components: { img: ZImage } })` from `zreader/content` if you want React elements instead of an HTML string.

Book covers render through the provider's `Image` component, which defaults to `<img>`:

```tsx
<ReaderProvider books={books} Image={MyImage}>…</ReaderProvider>
```

`MyImage` receives `{ src, alt, className, sizes }` and should fill a `relative` box, like `next/image` with `fill`.

## The viewer

Tap, click, Enter or Space on a block image opens it full screen:

- pinch, scroll or double-tap to zoom (up to 5×); drag to pan;
- `+`, `-` and `0` zoom in, zoom out and reset;
- swipe down, Escape or tap outside the image to close. Focus returns to the image.

The viewer shows the largest `srcset` candidate, and the figure caption if there is one. Taps on zoomable images never start a highlight.

Turn it off for every chapter with `content.images.lightbox: false`, or for one reader with `<Reader lightbox={false}>`. `ImageViewer` and `useImageViewer(root)` are exported from `zreader/react` for your own pages.

## Bookmarks and progress

A paragraph that holds only an image, or a `<figure>` without a caption, now gets a block id. That means reading progress and "resume where you left off" can land on it, and a bookmark placed there shows `Image: <alt>`. The id comes from the alt text, or the file name when there's no alt text, so replacing the file doesn't move the bookmark. Images can't be highlighted; captions can.

## Configuration

```ts
// reader.config.ts
export default defineConfig({
  content: {
    images: {
      allowRemote: true,                 // true | false | ["host", …]
      allowDataUri: true,
      maxDataUriBytes: 8 * 1024 * 1024,  // per image
      maxDataUriTotalBytes: undefined,   // per chapter
      warnDataUriTotalBytes: 2 * 1024 * 1024,
      allowSvgDataUri: false,
      probeRemote: false,
      probeTimeoutMs: 3000,
      lazy: true,
      lightbox: true,
      captions: true,
    },
    assets: {
      route: "_assets",
      extensions: ["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"],
    },
    sanitize: {
      svg: false, // keep inline <svg> in .md/.html chapters
    },
  },
});
```

Every option can also be set per [bookshelf](./configuration.md#bookshelves). Changing any of them recompiles cached chapters.

## Inline SVG

Inline `<svg>` in `.md` and `.html` chapters is removed by the sanitizer unless `sanitize.svg: true`. When it's on, DOMPurify's SVG profile applies: scripts, event handlers and `foreignObject` are still removed. MDX chapters aren't sanitized, so inline SVG always works there.
