# Getting started

## Install

```sh
npm i zreader
npm i @tiptap/react @tiptap/pm @tiptap/core @tiptap/starter-kit @tiptap/extension-list @tiptap/extensions @tiptap/markdown
```

The Tiptap packages power the scratchpad. They are listed as optional peer dependencies, but `zreader/react` lazy-loads the editor with `import("zreader/editor")`, and bundlers resolve that import at build time: both Next.js and Vite fail to build without them, even with `scratchpad.enabled: false`. Install them.

Requirements:

- React and React DOM 19 or later.
- Node 20.9 or later for the server entry points (`zreader/content`, `zreader/agent`, `zreader/next`).
- Next.js 15.5 or later for the Next.js adapter.

## Choose a path

| You have | Use |
| --- | --- |
| A Next.js app and chapters as files | The [Next.js path](#nextjs): the adapter loads, compiles and routes everything |
| A React app (Vite, React Router, …) | The [React path](#react-vite): you pass the catalogue and render chapters yourself |
| Chapters from a CMS or API | The React path, with `renderMarkdown()` / `renderHtml()` from [`zreader/content`](./content.md#rendering-content-from-elsewhere) on your server |

## Next.js

### 1. Add content

```
content/books/context-infra/
  book.json
  01-intro.md
  02-appendix-a-api-endpoint-reference.mdx
```

```json
// content/books/context-infra/book.json
{ "title": "Context Infrastructure", "description": "Build AI that understands your business." }
```

```md
<!-- content/books/context-infra/01-intro.md -->
---
title: Intro
---

Hello **world**.
```

The book id is the folder name (`context-infra`). The chapter id is the file name without the number prefix (`01-intro.md` → `intro`). See [Content layer](./content.md).

### 2. Wire Next.js

```ts
// next.config.ts
import { withReader } from "zreader/next";
export default withReader({});
```

```tsx
// app/books/layout.tsx
import { ReaderRoot } from "zreader/next/server";
import "zreader/styles.css";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <ReaderRoot>{children}</ReaderRoot>;
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
// app/books/[book]/[chapter]/page.tsx
import { getChapterParams, ReaderChapter } from "zreader/next/server";

export const generateStaticParams = getChapterParams;

export default async function Page({ params }: { params: Promise<{ book: string; chapter: string }> }) {
  return <ReaderChapter {...await params} />;
}
```

Open `/books`. Every page is statically generated.

### 3. Optional: make it agent-readable

Add a proxy and one flag, and every chapter gets a Markdown twin, an `/llms.txt` index, a `<link rel="alternate" type="text/markdown">` tag and a **Copy reference** button.

```ts
// proxy.ts (Next 16). On Next 15.5: middleware.ts, export `middleware`, add runtime: "nodejs" to config.
import { NextResponse } from "next/server";
import { createAgentHandler } from "zreader/agent";

const agent = createAgentHandler({ origin: "https://press.example.com" });

export async function proxy(req: Request) {
  return (await agent(req)) ?? NextResponse.next();
}
export const config = { matcher: ["/books/:path*.md", "/books.md", "/llms.txt"] };
```

```tsx
// app/books/layout.tsx
<ReaderRoot agent>{children}</ReaderRoot>
```

Now:

- `/books/context-infra/appendix-a-api-endpoint-reference.md` returns the chapter as Markdown.
- **Copy reference** copies `Refer the content at https://press.example.com/books/context-infra/appendix-a-api-endpoint-reference.md`.

See [Agent-readable content](./agent.md) and [Copy Reference](./copy-reference.md).

## React (Vite)

```tsx
// src/main.tsx
import { createRoot } from "react-dom/client";
import { BookShelf, Reader, ReaderProvider, type BookMeta } from "zreader/react";
import "zreader/styles.css";
import Intro from "./books/guide/intro.mdx"; // needs @mdx-js/rollup in vite.config

const books: BookMeta[] = [
  {
    id: "guide",
    title: "The Guide",
    authors: ["A. Writer"],
    chapters: [{ id: "intro", title: "Introduction", order: 1 }],
  },
];

function App() {
  const [, , book, chapter] = window.location.pathname.split("/"); // /books/:book/:chapter
  return (
    <ReaderProvider books={books}>
      {book && chapter ? (
        <Reader book={book} chapter={chapter}>
          <Intro />
        </Reader>
      ) : (
        <BookShelf />
      )}
    </ReaderProvider>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
```

Add `<meta name="viewport" content="width=device-width, initial-scale=1">` to `index.html`: the reader is mobile-first, and without it phones render the desktop layout.

To serve `.md` twins and the Copy reference button from a Vite app, see the [Vite section of Agent-readable content](./agent.md#vite).

## Next steps

- [Concepts](./concepts.md): ids, URLs, block ids and where data lives.
- [React](./react.md) for every component and prop.
- [Reader features](./reader-features.md) for what readers can do.
