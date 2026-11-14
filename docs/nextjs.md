# Next.js

The optional adapter loads the catalogue on the server, binds `next/link`, compiles chapters from `content/books/**`, and generates every page statically. Requires Next.js 15.5 or later (App Router).

## `withReader()`

```ts
// next.config.ts
import { withReader } from "zreader/next";
export default withReader({ reactStrictMode: true });
```

`withReader(nextConfig, options?)` accepts a config object or a config function and:

- finds `reader.config.*`, loads it with jiti and validates it, so `next dev` and `next build` fail fast with a readable error;
- aliases `zreader/user-config` to that file for Turbopack and webpack, so every server module sees the same config;
- keeps `jsdom` and `isomorphic-dompurify` external on the server (`serverExternalPackages`);
- traces the content folder into the server output (`outputFileTracingIncludes`) for every route, and for the proxy/middleware entry in webpack builds;
- points the compiled-chapter cache at `.next/cache/zreader`;
- keeps everything you already set (`webpack`, `turbopack.resolveAlias`, other tracing includes are merged, not replaced).

| Option | |
| --- | --- |
| `configPath` | Path to the config file. Default: discover `reader.config.{ts,mts,mjs,js}` |
| `root` | Project root. Default: `process.cwd()` |
| `config` | Inline overrides merged on top of the file |
| `verbose` | Log which config file was used |

## Pages

```tsx
// app/books/layout.tsx: provider with the whole catalogue and next/link
import { ReaderRoot } from "zreader/next/server";
import "zreader/styles.css";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <ReaderRoot headerSlot={<YourLogo />}>{children}</ReaderRoot>;
}
```

```tsx
// app/books/page.tsx
import { BookShelf } from "zreader/react";
export default function Page() {
  return <BookShelf />;
}
```

```tsx
// app/books/[book]/page.tsx
import { BookContents } from "zreader/react";
import { getBookParams } from "zreader/next/server";

export const generateStaticParams = getBookParams;

export default async function Page({ params }: { params: Promise<{ book: string }> }) {
  return <BookContents book={(await params).book} />;
}
```

```tsx
// app/books/[book]/[chapter]/page.tsx: compiles Markdown, MDX or HTML and renders <Reader>
import { getChapterParams, ReaderChapter } from "zreader/next/server";

export const generateStaticParams = getChapterParams;

export default async function Page({ params }: { params: Promise<{ book: string; chapter: string }> }) {
  return <ReaderChapter {...await params} />;
}
```

The folder names must match `reader.basePath` (default `/books` → `app/books/…`). With `basePath: "/read"`, use `app/read/…`.

## `ReaderRoot`

A server component that renders `NextReaderProvider` with `config.reader` as options and every book from the content layer as the catalogue.

| Prop | |
| --- | --- |
| `books` | Override the catalogue (default: `getBookMetas()`) |
| `headerSlot` | Default middle of the top bar. Must be a node (server-rendered), not a function |
| `readerActions` | Default buttons on the right of the top bar |
| `agent` | `true` or `{ prompt?, askPrompt?, providers?, label? }`: adds a Copy reference button and a Markdown `<link rel="alternate">` to every chapter. See [Copy Reference](./copy-reference.md#readerroot-agent) |
| …provider props | `manageTheme`, `toaster`, `overrides`, `children` |

Props that can't cross the server/client boundary (`Link`, `store`, `adapter`, `onStorageError`) aren't accepted. `hrefFor` is accepted by the type, but a server component can't pass a function to the client provider, so it fails at render. To use your own catalogue or functions, render `NextReaderProvider` from `zreader/next/client` in your own client component.

## `ReaderChapter`

A server component that loads a chapter with `getChapter()`, compiles it with `renderChapter()`, and renders `<Reader>` with the HTML (or the MDX component), the TOC and the content hash. Unknown ids call `notFound()`.

| Prop | |
| --- | --- |
| `book`, `chapter` | Route params |
| `components` | Extra MDX components, merged over the defaults (`{ Callout }`, also exported as `mdxComponents`) |
| `header` | Top-bar content for this chapter (a node) |
| `actions` | Replaces `readerActions` for this chapter; `null` hides them |
| …`<Reader>` props | `prev`, `next`, `backHref`, `className` |

## Other exports

| Export | |
| --- | --- |
| `getBookParams()` | `[{ book }]` for `app/books/[book]/page.tsx` |
| `getChapterParams()` | `[{ book, chapter }]` for `app/books/[book]/[chapter]/page.tsx` |
| `mdxComponents` | `{ Callout }` |
| `readerConfig`, `getClientOptions()` | The resolved config and its client half |
| `NextReaderProvider` (`zreader/next/client`) | `ReaderProvider` bound to `next/link` |

## Agent-readable pages

Add `proxy.ts` (Next 16) or `middleware.ts` (Next 15.5) with `createAgentHandler()` and `<ReaderRoot agent>`. See [Agent-readable content](./agent.md#nextjs).

## Deployment notes

- Pages are static (`generateStaticParams`). Content changes need a rebuild.
- `withReader` traces `content/books/**` into the server output so runtime reads (the agent proxy, dynamic pages) find the files on hosts like Vercel and in `output: "standalone"`.
- **Turbopack:** Next.js does not apply `outputFileTracingIncludes` to the proxy in Turbopack builds. `next start` and `output: "standalone"` still work, because the page traces include the content folder. On hosts that deploy the proxy as a separate function, check that `.md` URLs resolve after deploying, or build with `next build --webpack`. See [Troubleshooting](./troubleshooting.md#md-urls-404-or-are-empty-after-deploying).
