# Reader features

Everything here works without a server: all reader data stays in the browser.

## Highlights and notes

- **Select text** to open the selection toolbar: a swatch per highlight colour, **Whole sentence** (extend to the full sentence), **Add note**, **Quote to scratchpad** (when the scratchpad is enabled), **Copy** and **Dismiss**.
- **Highlight mode** (the highlighter button in the top bar, or the setting): tap a sentence to highlight it with the default colour.
- **Keyboard**, with text selected: `h` highlights, `n` highlights and opens the note editor.
- **Tap a highlight** to open its panel: change colour, write a note, delete it, quote it to the scratchpad, or copy it.
- **Images in notes:** paste or drop an image into a note, or use **Add image**. It's stored in this browser (see [Reader images](#reader-images)) and the note keeps a reference to it, shown as a thumbnail you can remove.
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
- **Math:** with [`<ScratchpadMath />`](./math.md#in-the-scratchpad), `$…$` and `$$…$$` render as formulas you can click to edit, and math quoted from a chapter arrives as TeX.
- **Runnable code:** with a Sandbox ([`<ScratchpadSandbox />`](./sandbox.md)), readers insert Python, JavaScript or TypeScript, run it with Run or Shift+Enter, and keep its Output in the pad. Variables carry over between runs in the same pad. Examples the author wrote in a chapter can be run, edited and copied into the pad too.
- **Images:** paste, drop or insert (toolbar) images. They're stored in this browser and saved in the pad's Markdown as `![name](zr-blob:<id>)`. Base64 images pasted as HTML are moved to the same store, so the pad stays small.
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

## Reader images

Images readers add to notes and scratchpads are stored in **IndexedDB** (database `<storagePrefix>:blobs`), not in `localStorage`, which holds only strings and about 5 MB. Records refer to them as `zr-blob:<id>`, where the id is a hash of the image, so the same image added twice is stored once.

- One image is limited to `userImages.maxBytes` (default 10 MB). Turn the feature off with `userImages.enabled: false`; images already added still show.
- The first image stored asks the browser for persistent storage.
- Without IndexedDB (server rendering, some private modes), images are kept in memory for the session.
- **Remove unused images** in Settings → Your data deletes images no note or scratchpad refers to any more, and shows how much space they use.
- A `zr-blob:` link only works in the browser that stored the image. Downloaded `.md` scratchpads keep the link; a backup carries the image itself.

In code: `createBlobStore(prefix)`, `createIndexedDbBlobStore`, `createMemoryBlobStore`, `referencedBlobs(store)` and `collectGarbage(blobs, referenced, { graceMs })` from `zreader`; `useBlobStore()`, `useBlobUrl(src)`, `useBlobUsage()`, `useAddImage()` and `<BlobImage src>` from `zreader/react`. Pass `<ReaderProvider blobStore>` to use your own store.

## Offline reading

Off by default. When it's on, every book's contents page gets a **Save for offline** button. It saves the book page, every chapter, and the scripts, styles and images they load, using a service worker and the Cache API. Saved pages are always loaded from the network first, so readers see the latest version when online and the saved copy when offline. **Remove** deletes the offline copy, keeping files that another saved book still uses.

To turn it on:

1. Set the option:

   ```ts
   // reader.config.ts
   reader: { offline: { enabled: true } } // serviceWorker defaults to "/zreader-sw.js"
   ```

2. Serve the worker from your site root. With Next.js:

   ```ts
   // app/zreader-sw.js/route.ts
   import { serviceWorkerRoute } from "zreader/next/server";
   export const { GET } = serviceWorkerRoute();
   ```

   Anywhere else, serve `serviceWorkerScript()` from `zreader/sw` with the `SW_HEADERS` headers.

The worker is registered with the shelf's `basePath` as its scope, so it only controls reader pages. It answers two kinds of request: page loads under that scope, and saved files. Pages and `/_next/static/` and `/_next/image` files are network first, so a new deploy never runs old code next to new pages; the saved copy answers when offline, and is refreshed when online. Only zreader's `/_assets/` URLs, which change whenever the file does, are cache first. It never caches anything on its own; only **Save for offline** adds files.

Offline, highlights, notes and the scratchpad keep working, because they're stored in the browser anyway. Client-side navigation between chapters falls back to full page loads, which come from the saved copy. Changing `cacheName` in `serviceWorkerScript({ cacheName })` drops every saved book.

In code: `useOfflineBook(book)` (`{ enabled, status, progress, save, remove }`) and `<SaveOffline book>` from `zreader/react`.

## Your data: backup and restore

Settings → **Your data**:

- **Export backup** downloads `reader-backup-<date>.json` with settings, highlights, notes, bookmarks, progress, scratchpads and the [images](#reader-images) they refer to, embedded as base64. A backup with images is format version 2; one without images is still version 1, so older readers can import it.
- **Import backup** merges a backup: lists are unioned by id, and the most recently updated version of each record wins. Images are restored with their ids. Turn on **Replace existing data on import** to wipe this browser's reader data first; images nothing refers to afterwards are removed.
- **Ask the browser to keep this data** requests persistent storage, so the browser is less likely to evict it.
- A reminder that data lives only in this browser is shown unless `backupReminder: false`.

Programmatic equivalents: `exportBackup(store, { bookId? })` (records only, synchronous), `exportBackupWithImages(store, blobs, { bookId? })`, `importBackup(store, json, { mode: "merge" | "replace" })`, `importBackupWithImages(store, blobs, json, { mode })`, `importBackupImages(blobs, json)` and `parseBackup(json)` from `zreader`. Backups from newer package versions are rejected with `BackupFormatError` rather than misread.

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

Images readers add live in IndexedDB, not under these keys: see [Reader images](#reader-images).

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
