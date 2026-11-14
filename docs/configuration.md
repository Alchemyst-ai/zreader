# Configuration

zreader works with no configuration. To change defaults, add `reader.config.ts` (or `.mts`, `.mjs`, `.js`) at the project root.

```ts
// reader.config.ts
import { defineConfig, glob, z } from "zreader/config";

export default defineConfig({
  content: {
    loader: glob({ base: "./content/books" }),
    sanitize: { allowIframes: ["www.youtube-nocookie.com"] },
  },
  reader: {
    basePath: "/books",
    highlightColors: ["yellow", "green", "blue", "pink"],
    defaultTheme: "system",
  },
});
```

The file has three halves:

- **`content`**: server-side options for the [content layer](./content.md). Never sent to the browser.
- **`reader`**: client options (plain JSON) for the UI and storage. `ReaderRoot` passes them to the provider; in other frameworks pass them as `<ReaderProvider options={config.reader}>`.
- **`agent`**: server-only [agent plugins](./agent.md). Never sent to the browser.

## Bookshelves

A **bookshelf** owns one route and everything under it: its own content folder, `basePath` and agent plugins. Declare one per route:

```ts
// reader.config.ts
import { defineConfig, glob } from "zreader/config";
import { frontmatter, llmsTxt, notFound } from "zreader/plugins/agent";

export default defineConfig({
  // Shared defaults, inherited by every shelf.
  content: { remarkPlugins: [], sanitize: { allowIframes: ["youtube.com"] } },
  reader: { defaultTheme: "sepia" },
  agent: { plugins: [frontmatter(), notFound()] },

  bookshelves: [
    {
      id: "books",
      basePath: "/books",
      content: { loader: glob({ base: "./content/books" }) },
      agent: { plugins: [llmsTxt({ full: true, root: true })] },
    },
    {
      id: "reports",
      basePath: "/reports",
      title: "Quarterly reports",
      description: "Results and commentary, every quarter.",
      content: { loader: glob({ base: "./content/reports" }) },
      agent: { plugins: [llmsTxt()] },
    },
  ],
});
```

| Key | |
| --- | --- |
| `id` | Letters, digits, `-` and `_`. Used by `ReaderRoot shelf="…"`, `getShelf("…")` and storage keys |
| `basePath` | Where the shelf is mounted. Must start with `/`; `/` is allowed |
| `title` | Shelf `.md` H1, `llms.txt` H1, frontmatter. Default `"Books"` |
| `description` | Shelf summary |
| `content` | Merged over the top-level `content` |
| `reader` | Merged over the top-level `reader` (client options), minus `basePath` |
| `agent.plugins` | Merged with the top-level `agent.plugins` |

Every zreader surface — the agent handler, `ReaderRoot`, `ReaderChapter`, the static params helpers, `withReader` tracing — reads shelves from this one declaration, because the proxy handler cannot read React props.

### The implicit shelf

When `bookshelves` is absent, zreader creates one shelf from the top-level keys, with `id: "books"` and `reader.basePath`. So an existing `reader.config.ts` resolves to exactly one shelf with the same folder and base path as before, and single-shelf code keeps working unchanged.

When `bookshelves` is present, `reader.basePath` at the top level is an error, so there is never any doubt which base path wins.

The **default shelf** is the first one in the array. It is what the module-level functions (`getBooks()`, `getChapter()`, …) and a bare `<ReaderRoot>` use.

### Shelves cannot be nested

Each shelf owns exactly one route and everything under it: `/books` is one shelf, `/reports` is another. A shelf's `basePath` may not sit inside another's.

| Shelves | Allowed? | Why |
| --- | --- | --- |
| `/books`, `/reports` | Yes | Siblings |
| `/books`, `/bookstore` | Yes | Compared by path segment, not by string prefix |
| `/docs/books`, `/docs/reports` | Yes | Siblings under a path zreader doesn't own |
| `/books`, `/books/shelf1` | No | `/books/shelf1` is inside `/books` |
| `/docs`, `/docs/books` | No | Same, one level deeper |
| `/`, `/books` | No | `/` contains every path |

Why it is a hard rule:

- **Routing is unambiguous.** Under `/books`, the first segment is always a book id. A nested `/books/shelf1` would be indistinguishable from a book called `shelf1` — in the agent handler, in the Next.js `app/` folder and in `hrefFor` links.
- **Scope stays clean.** "This shelf's books only" would be ambiguous for `/books/llms.txt` if another shelf lived under `/books`.
- **The handler is simple.** A path belongs to at most one shelf, so lookup needs no longest-prefix rules.

A site that wants grouping (e.g. "archived books") uses a sibling shelf (`/archive`) or a `part` within a book, not a nested shelf.

### Validation

Checked at `next dev` / `next build` start, and reported through `ReaderConfigError`:

| Rule | Error |
| --- | --- |
| `id` matches `/^[a-z0-9][a-z0-9_-]*$/i` | `bookshelves[1].id: use letters, digits, '-' or '_'` |
| `id`s are unique | `bookshelves[1].id: duplicate id "books"` |
| `basePath` starts with `/` | as for the top level |
| `basePath`s are unique after trimming trailing slashes | `bookshelves[1].basePath: "/books" is already used by "books"` |
| No `basePath` inside another | `bookshelves[1].basePath: "/books/shelf1" is inside "/books" (bookshelf "books"); bookshelves cannot be nested` |
| `basePath: "/"` only when it is the sole shelf | `bookshelves[1].basePath: "/" would contain every other bookshelf; bookshelves cannot be nested` |
| At most one shelf claims root `/llms.txt` | `bookshelves[1].agent.plugins: /llms.txt is already claimed by "books"` |
| Each plugin is an object with a string `name` | `bookshelves[0].agent.plugins[2]: not a zreader agent plugin` |
| Within one shelf, plugin `name`s are unique after merging | `bookshelves[0].agent.plugins: two "llmsTxt" plugins` |
| Each `content.loader.base` exists (warning, not error) | `[zreader] bookshelf "reports": ./content/reports does not exist` |

### Merging

- **`content`:** `mergeConfig(defaults, top-level content, shelf content)` — the existing deep merge (arrays and schemas replace).
- **`reader`:** `mergeConfig(DEFAULT_CLIENT_OPTIONS, top-level reader, shelf reader)`, then `basePath` is set from the shelf.
- **`agent.plugins`:** top-level plugins first, then the shelf's. A shelf plugin with the same `name` **replaces** the inherited one in place, keeping its run order. To drop an inherited plugin, a shelf lists `disable("notFound")`.

### Storage keys

Highlights, notes and progress are keyed by `storagePrefix` + book id, and two shelves can contain books with the same id, so:

- The **default shelf** keeps `reader.storagePrefix` (`"zr"`), so existing readers keep their data.
- **Every other shelf** defaults to `${storagePrefix}-${shelf.id}` (e.g. `zr-reports`) unless it sets `reader.storagePrefix` itself.

## How it's loaded

- **Next.js:** `withReader()` finds the file, loads it with jiti (TypeScript works without a build step), validates it and fails `next dev` / `next build` with a readable error if it's invalid. Options: `withReader(nextConfig, { configPath, root, config, verbose })`, where `config` is an inline override merged on top of the file.
- **Elsewhere** (Vite plugins, scripts, tests): the first import of a server entry point discovers the file in `process.cwd()`.
- **Resolution order:** package defaults ← `reader.config.ts` ← inline overrides. Plain objects merge key by key; arrays and schemas replace; `undefined` never overrides.

## `content`

| Option | Type | Default | |
| --- | --- | --- | --- |
| `loader` | `glob({ base, pattern?, ignore? })` | `glob({ base: "./content/books" })` | `base` is relative to the project root; `pattern` defaults to `**/*.{md,mdx,html}` |
| `schemas.book` | zod schema | see below | Validates `book.json` |
| `schemas.chapter` | zod schema | see below | Validates chapter frontmatter |
| `remarkPlugins` | unified plugins | `[]` | Applied to `.md` and `.mdx` |
| `rehypePlugins` | unified plugins | `[]` | Applied to `.md` and `.mdx`, before block ids |
| `sanitize.allowIframes` | string[] | `[]` | `https` iframe hosts to keep (subdomains included) |
| `sanitize.allowTags` | string[] | `[]` | Extra tags allowed by DOMPurify |
| `sanitize.allowAttributes` | string[] | `[]` | Extra attributes allowed by DOMPurify |
| `includeDrafts` | boolean | `true` in development | Show `draft: true` chapters |
| `cacheDir` | string | `node_modules/.cache/zreader` (`ZREADER_CACHE_DIR` env var; `withReader` sets `.next/cache/zreader`) | Compiled chapter cache |

### Schemas

The defaults are loose objects (extra keys allowed and kept):

```ts
// book.json
z.looseObject({
  title: z.string(),
  subtitle: z.string().optional(),
  authors: z.array(z.string()).default([]),
  description: z.string().optional(),
  cover: z.string().optional(),
  chapters: z.array(z.string()).optional(),
});

// chapter frontmatter
z.looseObject({
  title: z.string(),
  order: z.number().optional(),
  description: z.string().optional(),
  part: z.string().optional(),
  label: z.string().optional(),
  number: z.union([z.string(), z.number()]).transform(String).optional(),
  draft: z.boolean().default(false),
});
```

To require or add fields, extend them (they're exported as `defaultBookSchema` and `defaultChapterSchema`):

```ts
import { defineConfig, defaultChapterSchema, z } from "zreader/config";

export default defineConfig({
  content: {
    schemas: { chapter: defaultChapterSchema.extend({ readingTime: z.number() }) },
  },
});
```

Any object with a zod-style `safeParse` works. Custom fields end up in `chapter.data` / `book.data`; the reader UI only uses the fields above.

## `reader`

| Option | Type | Default | |
| --- | --- | --- | --- |
| `basePath` | string (starts with `/`) | `"/books"` | Root of reader URLs. Also the root of `.md` twins |
| `storagePrefix` | string (letters, digits, `-`, `_`) | `"zr"` | Storage keys become `<prefix>:v1:*` |
| `highlightColors` | subset of `yellow`, `green`, `blue`, `pink`, `purple`, `orange` | `["yellow", "green", "blue", "pink"]` | Swatches offered to readers |
| `defaultHighlightColor` | one of `highlightColors` | `"yellow"` | Used by highlight mode and the `h` key |
| `scratchpad.enabled` | boolean | `true` | Show the scratchpad |
| `scratchpad.scopes` | `("chapter" \| "book" \| "global")[]` | `["chapter", "book", "global"]` | Which pads readers can switch between |
| `themes` | subset of `system`, `light`, `sepia`, `dark` | all four | Themes offered in settings |
| `defaultTheme` | one of `themes` | `"system"` | |
| `defaultSettings.textSize` | `sm` `base` `lg` `xl` `2xl` | `"lg"` | |
| `defaultSettings.leading` | `tight` `normal` `relaxed` | `"relaxed"` | Line spacing |
| `defaultSettings.measure` | `narrow` `normal` `wide` | `"normal"` | Line width: 58, 68 or 82 characters |
| `defaultSettings.fontFamily` | `serif` `sans` `mono` | `"serif"` | |
| `defaultSettings.highlightMode` | boolean | `false` | Tap a sentence to highlight it |
| `progress.completeAt` | number (0–1] | `0.9` | Scroll fraction at which a chapter counts as read |
| `progress.saveIntervalMs` | number ≥ 100 | `1000` | How often reading position is saved |
| `backupReminder` | boolean | `true` | Remind readers that their notes live only in this browser |

`defaultSettings` are the starting values; each reader's own choices are saved and win.

## Validation errors

Invalid options throw `ReaderConfigError` listing every problem by path:

```
Invalid reader config (reader.config.ts):
  - reader.basePath: Invalid string: must start with "/"
  - reader.defaultHighlightColor: defaultHighlightColor must be one of highlightColors
  - bookshelves[1].basePath: "/books" is already used by "books"
```

Invalid `book.json` or frontmatter throws `ContentError` with the file path; see [Content layer](./content.md).

## Using the config in code

```ts
import { readerConfig, getClientOptions } from "zreader/next/server"; // Next.js
import { getReaderConfig, getShelf, getShelves } from "zreader/content"; // any server
import { resolveConfig, mergeConfig, clientOptions } from "zreader/config"; // build your own
```

`getShelf(id?)` is the content API for one shelf (`getBooks`, `getBook`, `getChapter`, `getBookMetas`, `renderChapter`, `getStaticParams`, plus `shelf()`); `getShelves()` lists the resolved shelves. `clientOptions(config, shelfId?)` is that shelf's client options.
