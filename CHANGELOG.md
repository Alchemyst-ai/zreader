# Changelog

## Unreleased

- New `zreader/agent`: `createAgentHandler()` serves agent-readable Markdown twins of every page (`/books/<book>/<chapter>.md`, `/books/<book>.md`, `/books.md`) and `/llms.txt`. MDX is cleaned up and HTML is converted to Markdown.
- New `zreader/agent/react`: `<CopyReference />` copies a prompt that points an AI agent at the current chapter, with a menu to open it in ChatGPT, Claude or Grok.
- In `.md` twins, `<embed>`, `<iframe>`, `<object>`, `<video>` and `<audio>` become links to their files (so linked PDFs stay reachable), `<br />` becomes a line break, and MDX that can't be parsed is served as its raw source instead of failing.
- `<Reader actions>` and the provider's `readerActions` add buttons to the top bar; a chapter's `actions` replaces the provider's, `null` hides them. `useReaderChapter()` also returns `href`.
- `<ReaderRoot agent>` turns on `<CopyReference markdown />` and a `<link rel="alternate" type="text/markdown">` tag (`<MarkdownAlternate />`) for every chapter. `ReaderRoot` also takes `readerActions`.
- `withReader()` traces the content directory into the proxy/middleware (webpack).
- **Breaking:** the Next.js adapter now requires Next.js 15.5 or later.

## 0.1.0

First release.

- A React reader with a shelf, a contents page per book, and a chapter view.
- Bookmarks, reading progress and resume, sentence highlights in six colours with notes.
- A WYSIWYG Markdown scratchpad (Tiptap) per chapter, per book and globally, lazy-loaded from `zreader/editor`.
- Reading settings: theme (light, dark, sepia), text size, line spacing, measure and font.
- All reader data stays in `localStorage` under `zr:v1:*`, with JSON backup and restore.
- The `zreader/rehype` plugin adds block ids at build time; content without ids gets them in the browser.
- An optional content layer (`zreader/content`) for Markdown, MDX and HTML books.
- An optional Next.js adapter (`zreader/next`, `zreader/next/client`, `zreader/next/server`).
- Requires React 19 or later.
