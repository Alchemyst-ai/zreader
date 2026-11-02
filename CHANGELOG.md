# Changelog

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
