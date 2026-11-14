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

The file has two halves:

- **`content`**: server-side options for the [content layer](./content.md). Never sent to the browser.
- **`reader`**: client options (plain JSON) for the UI and storage. `ReaderRoot` passes them to the provider; in other frameworks pass them as `<ReaderProvider options={config.reader}>`.

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
```

Invalid `book.json` or frontmatter throws `ContentError` with the file path; see [Content layer](./content.md).

## Using the config in code

```ts
import { readerConfig, getClientOptions } from "zreader/next/server"; // Next.js
import { getReaderConfig } from "zreader/content";                     // any server
import { resolveConfig, mergeConfig } from "zreader/config";            // build your own
```
