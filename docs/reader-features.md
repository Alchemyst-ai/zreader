# Reader features

Everything here works without a server: all reader data stays in the browser.

## Highlights and notes

- **Select text** to open the selection toolbar: a swatch per highlight colour, **Whole sentence** (extend to the full sentence), **Add note**, **Quote to scratchpad** (when the scratchpad is enabled), **Copy** and **Dismiss**.
- **Highlight mode** (the highlighter button in the top bar, or the setting): tap a sentence to highlight it with the default colour.
- **Keyboard**, with text selected: `h` highlights, `n` highlights and opens the note editor.
- **Tap a highlight** to open its panel: change colour, write a note, delete it, quote it to the scratchpad, or copy it.
- **Contents → Highlights** lists every highlight in the book; tap one to jump to it. Each highlight also has a link of the form `/books/<book>/<chapter>#hl-<id>`.
- **Export**: Reading settings → Highlights (.md) downloads the book's highlights and notes as Markdown.

### How highlights stay attached

Highlights are stored as W3C Web Annotation-style anchors: the start block's id and offset, positions over the chapter text, and the quoted text with a prefix and suffix. When the chapter is edited, re-anchoring falls back in order: the stored position, the block's relative offset, the quote with its context, then a fuzzy match. A highlight that can't be placed is **kept** and listed as unplaced under Contents → Highlights rather than deleted.

Highlights are painted with the [CSS Custom Highlight API](https://developer.mozilla.org/docs/Web/API/CSS_Custom_Highlight_API), so the DOM is never modified. In browsers without it, highlights are still saved and listed, and the reader shows a notice that they can't be drawn.

Elements with `data-zr-ignore` (such as `<Callout>`) are excluded from highlighting.

## Bookmarks

- The bookmark button in the top bar bookmarks the block at the top of the screen, with the chapter title and an excerpt. Pressing it again removes the chapter's bookmarks, with **Undo**.
- **Contents → Bookmarks** lists them; tap one to jump back.

## Reading progress

- The thin bar under the top bar shows how far through the chapter you are.
- The position (top block and percentage) is saved every `progress.saveIntervalMs` (default 1 s) and when the page is hidden.
- A chapter counts as read when you scroll past `progress.completeAt` (default 90%), or with **Mark chapter as read** at the end.
- The book page's **Continue** card and the chapter list show read state and resume where you left off.

## Scratchpad

A WYSIWYG Markdown editor (Tiptap) with checklists (`- [ ]`).

- Three scopes, switchable in the panel: **Chapter**, **Book** and **Global**. Configure which are offered with `scratchpad.scopes`, or turn it off with `scratchpad.enabled: false`.
- **Quote to scratchpad** appends the passage (and its note) as a Markdown quote with a link back to the highlight.
- Panel menu: **Download .md**, **Copy markdown**, **Clear** (with Undo).
- On desktop (1024px and up) it opens as a resizable side panel; the split is remembered. On mobile it opens as a bottom drawer.
- The editor is loaded on first open (`zreader/editor`), so it doesn't weigh down the first page load. The Tiptap packages still have to be installed; see [Getting started](./getting-started.md#install).

## Reading settings

The **Aa** button opens settings:

| Setting | Values |
| --- | --- |
| Theme | Auto, Light, Sepia, Dark (as configured in `themes`) |
| Text size | sm, base, lg, xl, 2xl |
| Line spacing | tight, normal, relaxed |
| Line width | narrow, normal, wide |
| Font | Serif, Sans, Mono |
| Highlight mode | on / off |

**Reset reading settings** returns to `defaultSettings`. Settings apply to every book.

## Your data: backup and restore

Settings → **Your data**:

- **Export backup** downloads `reader-backup-<date>.json` with settings, highlights, notes, bookmarks, progress and scratchpads.
- **Import backup** merges a backup: lists are unioned by id, and the most recently updated version of each record wins. Turn on **Replace existing data on import** to wipe this browser's reader data first.
- **Ask the browser to keep this data** requests persistent storage, so the browser is less likely to evict it.
- A reminder that data lives only in this browser is shown unless `backupReminder: false`.

Programmatic equivalents: `exportBackup(store, { bookId? })`, `importBackup(store, json, { mode: "merge" | "replace" })` and `parseBackup(json)` from `zreader`. Backups from newer package versions are rejected with `BackupFormatError` rather than misread.

## Storage

Keys live under `<storagePrefix>:v1:` (default `zr:v1:`):

| Key | Holds |
| --- | --- |
| `settings` | Reading settings |
| `book:<bookId>:highlights` | Highlights and notes |
| `book:<bookId>:bookmarks` | Bookmarks |
| `book:<bookId>:progress` | Per-chapter progress and the last position |
| `pad:global`, `pad:book:<bookId>`, `pad:chapter:<bookId>:<chapterId>` | Scratchpads |
| `theme` | The theme (managed by `next-themes`) |

Ids in keys are URL-encoded.

- Every record is wrapped in a versioned envelope and migrated forward when the format changes. Records written by a newer version are left untouched.
- Corrupt records are dropped item by item; one bad highlight doesn't lose the rest.
- Tabs stay in sync through the `storage` event.
- Writes are debounced (200 ms) and flushed when the page is hidden.
- Quota errors are reported to `onStorageError` (default: `console.warn`).
- If `localStorage` is unavailable (private modes, sandboxed iframes), the reader falls back to memory: it works, but nothing persists.

### Custom storage

Pass any `StorageAdapter` to `<ReaderProvider adapter>`, for example one backed by IndexedDB or your own API:

```ts
import type { StorageAdapter } from "zreader";

const adapter: StorageAdapter = {
  get: (key) => …,            // string | null
  set: (key, value) => …,
  remove: (key) => …,
  keys: (prefix) => …,        // string[]
  subscribe: (listener) => …, // call listener(key) when another tab/device changes a key; return an unsubscribe function
};
```

`createLocalStorageAdapter()` and `createMemoryAdapter()` are exported from `zreader`, as is `createReaderStore()` for using the store without React.
