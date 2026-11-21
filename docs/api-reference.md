# API reference

Every entry point and what it exports. Types are listed after values. For behaviour, follow the links to the guides; for how the entry points depend on each other, see [Architecture](./architecture.md).

## `zreader/react`

Browser. The reader UI. See [React](./react.md).

**Provider and context**

- `ReaderProvider` and `ReaderProviderProps`
- `useReader()`, `useLibrary()`, `useBook(bookOrId)`, `useReaderStore()`
- `mergeOptions(base, ...overrides)`
- Types: `Library`, `HrefFor`, `HeaderSlot`

**Components**

- `BookShelf` (`BookShelfProps`)
- `BookContents` / `BookHome` (`BookContentsProps` / `BookHomeProps`)
- `ContinueReading`, `ChapterList` (`BookNavProps`)
- `Reader` (`ReaderProps`), `ReaderTitle`, `useReaderChapter()` (`ReaderChapterValue`)
- `Callout` (`CalloutProps`), `ZImage` (`ZImageProps`), `BookCover`
- `SaveOffline`, `useOfflineBook(book)` (`OfflineStatus`)
- `BlobImage` (`BlobImageProps`), `imageFiles(dataTransfer)`, `noteImages(note)`, `noteText(note)`
- `ImageViewer` (`ImageViewerProps`), `useImageViewer(root, enabled?)`, `describeImage(img)`, `ZOOMABLE_SELECTOR` (`ViewerImage`)
- Building blocks: `ContentsSheet` (`ContentsSheetProps`, `ContentsTab`), `HighlightPanel`, `SelectionToolbar`, `SettingsPanel`, `ScratchpadPanel`, `scopeFor`, `scopeKey`, `ResponsivePanel`

**Hooks**

- `useSettings()`, `useHighlights(bookId, chapterId?)`, `useBookmarks(bookId)`, `useProgress(bookId)`, `usePad(scope)`
- `useBlobStore()`, `useBlobUrl(src)`, `useBlobUsage()`, `useAddImage()`
- `useHydrated()`, `useMediaQuery(query, serverValue?)`, `useIsDesktop()`
- `useChapterEngine(options)` (`ChapterEngine`, `ChapterEngineOptions`, `SelectionState`), `useValueStore(store)`

**Utilities**

- `DefaultLink`, `defaultHref(basePath, bookId, chapterId?, hash?)`, `LinkComponent`
- `DefaultImage`, `ImageComponent`
- `groupByPart(chapters)` (`PartGroup`), `chapterMarker(chapter, index)`
- `copyText(text)`, `downloadFile(filename, content, type?)`
- Class maps: `PROSE_CLASS`, `TEXT_SIZE_CLASS`, `LEADING_CLASS`, `MEASURE_CLASS`, `FONT_CLASS`, `SWATCH_CLASS`, `swatchClass(color)`, `QUOTE_BORDER_CLASS`, `quoteBorderClass(color)`
- Re-exported types: `BookMeta`, `ChapterMeta`, `TocEntry`, `Highlight`, `HighlightColor`, `Bookmark`, `BookProgress`, `ChapterProgress`, `Pad`, `PadScope`, `ReaderSettings`, `ReaderClientOptions`, `ThemeName`

## `zreader/agent/react`

Browser. See [Copy Reference](./copy-reference.md).

- `CopyReference` (`CopyReferenceProps`)
- `MarkdownAlternate`
- `markdownUrl(pageUrl)`, `markdownHref(href)`, `formatPrompt(template, url)`, `providerUrl(provider, prompt)`, `resolveProvider(provider)`
- `PROVIDERS`, `DEFAULT_PROVIDERS`, `DEFAULT_PROMPT`, `DEFAULT_ASK_PROMPT`
- Types: `BuiltInProvider` (`"chatgpt" | "claude" | "grok"`), `ProviderSpec` (`{ id, label, href(prompt) }`)

## `zreader/agent`

Node. See [Agent-readable content](./agent.md).

**Handler**

- `createAgentHandler(options?)`: `(request: Request) => Promise<Response | undefined>` — serves every shelf by default
- `matchAgentRoute(pathname, basePath)`: `AgentRouteMatch | null` (`{ kind: "shelf" }`, `"book"` or `"chapter"`)
- `requestOrigin(request)`
- Types: `AgentHandler`, `AgentHandlerOptions` (`shelves`, `origin`, `cacheControl`, `devWarnings`, `assets`, `sources`), `AgentContentSource`, `AgentRouteMatch`

**Converters and helpers**

- `chapterToMarkdown(lookup, ctx)`, `bookToMarkdown(book, ctx)`, `shelfToMarkdown(books, ctx, { title?, description? })`
- `llmsTxt(books, ctx, { title?, description? })`, `fullTextToMarkdown(books, ctx, opts?)`
- `notFoundToMarkdown(info, ctx, opts?)`, `renderFrontmatter(fields)`, `isValidFrontmatterKey(key)`
- `demoteHeadings(markdown, by)`
- `resolveLastUpdated(entry, override?)`, `newestLastUpdated(entries, override?)`, `newestBookLastUpdated(books, override?)`
- `chapterBodyToMarkdown(entry)`, `mdxToMarkdown(source)`, `htmlToMarkdown(html)`
- `pageUrl(ctx, book?, chapter?)`, `markdownPageUrl(ctx, book?, chapter?)`
- Types: `AgentUrlContext` (`{ origin, basePath }`), `LlmsTxtOptions`, `ShelfOptions`, `LastUpdatedInput`, `NotFoundMarkdownOptions`
- Plugin types (re-exported): `AgentPlugin`, `AgentPluginRoute`, `AgentPluginContext`, `AgentPluginMethod`, `AgentDocument`, `DocumentMeta`, `NotFoundInfo`

Browser bundles resolve this entry to a stub that throws.

## `zreader/plugins/agent`

Node. Opt-in plugins for `zreader/agent`, declared in `reader.config.ts`. See [Agent plugins](./plugins.md).

**Factories**

- `frontmatter(opts?)` (`FrontmatterOptions`: `title`, `lastUpdated`, `extra`)
- `llmsTxt(opts?)` (`LlmsTxtPluginOptions`: `full`, `root`, `title`, `description`)
- `notFound(opts?)` (`NotFoundOptions`: `title`, `maxBooks`, `maxChapters`, `render`)
- `cors(opts?)` (`CorsOptions`: `origin`, `vary`, `maxAge`)
- `mcp(opts?)` (`McpOptions`: `path`, `name`, `search`, `tools`; `SearchHit`)
- `disable(name)`

**Authoring types**

- `AgentPlugin` (`name`, `routes`, `rootRoutes`, `document`, `headers`, `setup`)
- `AgentPluginRoute` (`path`, `methods`, `handle`), `AgentPluginMethod`
- `AgentPluginContext` (`shelf`, `api`, `url`, `request`, `methods`, `respond`, `document`)
- `AgentDocument` (`kind`, `body`, `meta`, `preamble`, `status`, `book`, `chapter`, `notFound`), `DocumentMeta`, `NotFoundInfo`

Browser bundles resolve this entry to a stub that throws.

## `zreader/content`

Node. See [Content layer](./content.md).

- `getBooks()`, `getBookMetas()`, `getBook(id)`, `getChapter(bookId, chapterId)`, `renderChapter(entry)`, `getStaticParams(names?)`, `getReaderConfig()`
- `getShelf(id?)`: one shelf's API (`getBooks`, `getBook`, `getBookMetas`, `getChapter`, `renderChapter`, `getStaticParams`, `shelf()`); the default shelf when omitted
- `getShelves()`: every resolved `ResolvedShelf`
- `defineBooks(contentOptions | resolvedConfig)`: a separate API with the same methods, for content that isn't a shelf
- `toBookMeta(bookEntry)`, `loadBooks(config)`, `compileChapter(entry, config)`, `ContentError`
- `renderMarkdown(md, opts?)`, `renderHtml(html, opts?)`, `annotateHtml(html, opts?)`, `compileMdx(source, opts?)`, `runMdx(code)`, `sanitizeHtml(html, sanitize?)`
- `htmlToReact(html, { components })`: compiled HTML as React elements
- Images ([Images](./images.md)): `rehypeImages(opts?)`, `checkImageUrl(src, images?)`, `classifyImageUrl(src)`, `hostAllowed(host, list)`, `parseDataUri(src)`, `parseSrcset(value)`, `stringifySrcset(list)`, `measureFile(file)`, `probeRemoteImage(src, timeoutMs)`, `formatBytes(n)`
- Math ([Math](./math.md)): `rehypeMath({ math })`, `rehypeMathDelimiters()`, `getMathRenderer(config)`, `resolveMath(option)`, `toMathElement(markup, tex, display)`, `MathEngineMissingError`, `MATH_PACKAGES` (`MathRenderer`, `RehypeMathOptions`)
- Assets: `createAssetHandler({ shelves?, cacheControl? })`, `serveAsset(request, opts)`, `resolveBookAsset(src, ctx)`, `matchAssetRoute(pathname, basePath, route)`, `assetUrl(ctx, hash, path)`, `ASSET_TYPES`, `SVG_CSP`
- `rehypeBlocks`, `hashString`, `glob`, `defineConfig`, `z`
- Types: `BookEntry`, `ChapterEntry`, `ChapterLookup`, `RenderedChapter`, `ShelfApi`, `HtmlResult`, `MdxCompiled`, `MdxContent`, `MdxComponents`, `ChapterFormat`, `PipelineOptions`, `ImagePipelineOptions`, `ImageDimensions`, `ImageUrlKind`, `ResolvedLocalImage`, `BookAssetContext`, `AssetRouteMatch`, `ServeAssetOptions`, `HtmlToReactOptions`, `CompileDependency`, `ImageOptions`, `AssetOptions`, `MathOption`, `MathEngine`, `MathConfig`, `BlockInfo`, `BlocksData`, `ReaderUserConfig`, `ResolvedReaderConfig`, `ResolvedShelf`, `BookshelfConfig`, `SanitizeOptions`, `ContentConfig`, `GlobLoader`

Browser bundles resolve this entry to a stub that throws.

## `zreader/config`

Node (ESM and CJS). See [Configuration](./configuration.md).

- `defineConfig(config)`, `glob({ base, pattern?, ignore? })`, `z` (zod v4)
- `resolveConfig(user?, inline?, { root?, source? })`, `mergeConfig(base, ...overrides)`, `clientOptions(resolved, shelfId?)`
- `shelfById(config, id?)`, `defaultShelfOf(config)`, `mergePlugins(top, own)`, `applyDisables(plugins)`
- `normalizeBasePath(basePath)`, `pathContains(outer, inner)`
- `defaultContentConfig()`, `defaultImageOptions()`, `DEFAULT_ASSET_EXTENSIONS`, `MATH_ENGINES`, `defaultBookSchema`, `defaultChapterSchema`
- `ReaderConfigError` (with `issues: { path, message }[]`), `CONFIG_FILE_NAMES`
- Types: `ReaderUserConfig` (`content`, `reader`, `agent`, `bookshelves`), `BookshelfConfig`, `ResolvedReaderConfig` (`root`, `content`, `reader`, `shelves`, `defaultShelf`), `ResolvedShelf`, `ContentConfig`, `GlobLoader`, `SanitizeOptions`, `ImageOptions`, `AssetOptions`, `MathOption`, `MathEngine`, `MathConfig`, `PluginList`, `DeepPartial`

## `zreader/next`

Node (ESM and CJS), for `next.config.*`. See [Next.js](./nextjs.md).

- `withReader(nextConfig?, options?)` (`WithReaderOptions`: `configPath`, `root`, `config`, `verbose`)
- `setupReader(options?)`, `applyReaderConfig(base, setup, root)`, `readerImagesConfig(images, resolved)`: the pieces of `withReader`, exported for testing and custom setups
- `resolveConfig`, `findConfigFile(root)`, `loadConfigFile(file)`
- `USER_CONFIG_SPECIFIER`, `EMPTY_CONFIG_SPECIFIER`, `SERVER_EXTERNALS`

## `zreader/next/server`

React Server Components.

- `ReaderRoot` (`ReaderRootProps` with `shelf`, `devWarnings`; `ReaderRootAgentOptions`)
- `ReaderChapter` (`ReaderChapterProps` with `shelf`)
- `getBookParams(shelf?)`, `getChapterParams(shelf?)`
- `agentMatcher(shelf)`, `mdxComponents`, `readerConfig`, `getClientOptions(shelf?)`
- `serviceWorkerRoute(options?)`: `{ GET }` serving the offline worker
- `assetRoute(shelf?)`: `{ GET, HEAD }` for `app/<shelf>/[book]/%5Fassets/[...path]/route.ts`
- `createReaderImage(images)`, `imageDecision(src, hasSrcset, images)` (`ReaderImageDecision`)

## `zreader/next/client`

Browser.

- `NextReaderProvider` (`NextReaderProviderProps`): `ReaderProvider` with `Link` bound to `next/link` and `Image` to `NextCoverImage`
- `NextCoverImage`: book covers through `next/image` with `fill`

## `zreader/editor`

Browser. Lazy-loaded by the scratchpad; import it directly only for a custom editor UI.

- `ScratchpadEditor` (default export too) with `ScratchpadEditorProps`: `scope`, `placeholder?`, `autoFocus?`, `onFocus?`, `className?`

Needs the Tiptap peer dependencies.

## `zreader/sw`

Anywhere (the script is a string). See [Offline reading](./reader-features.md#offline-reading).

- `serviceWorkerScript({ cacheName?, immutablePrefixes? })`: the worker's source
- `SW_HEADERS`, `SW_CACHE`, `SW_PATH`
- Types: `ServiceWorkerOptions`, `ServiceWorkerMessage`, `ServiceWorkerReply`

## `zreader/rehype`

Build time, no Node APIs.

- `rehypeBlocks(options?)` (default export too), `RehypeBlocksOptions` (`tocDepth?: [min, max]`, default `[2, 3]`)
- Adds `data-block-id` to blocks and ids to headings, and writes `{ toc, blocks, contentHash }` to `file.data.reader`
- Types: `BlockInfo`, `BlocksData`

## `zreader` (core)

Framework-free. Used by every other entry point.

**Store and storage**

- `createReaderStore(options?)` (`ReaderStore`, `ReaderStoreOptions`, `Cell`)
- `createLocalStorageAdapter(storage?)`, `createMemoryAdapter(initial?)`, `getLocalStorage()`, `requestPersistentStorage()`
- `StorageAdapter`, `StorageQuotaError`, `padKeySuffix(scope)`, `defaultId()`

The store's methods:

- Settings: `updateSettings`, `resetSettings`
- Highlights: `addHighlight`, `updateHighlight`, `removeHighlight`
- Bookmarks: `addBookmark`, `removeBookmark`, `findChapterBookmark`, `toggleChapterBookmark`
- Progress: `recordProgress`, `markChapterComplete`
- Scratchpads: `savePad`, `appendToPad`, `clearPad`
- Cells for subscriptions: `settings()`, `highlights(bookId)`, `bookmarks(bookId)`, `progress(bookId)`, `pad(scope)`
- Lifecycle: `keys`, `flush`, `connect`, `reloadAll`

**Backup**

- `exportBackup(store, { bookId? })`, `importBackup(store, input, { mode? })` (`ImportResult`), `parseBackup(input)`
- `exportBackupWithImages(store, blobs, opts?)`, `importBackupWithImages(store, blobs, input, opts?)` (`ImportWithImagesResult`), `importBackupImages(blobs, input)` (`BackupBlob`)
- Reader images: `createBlobStore(prefix)`, `createIndexedDbBlobStore(prefix, idb?)`, `createMemoryBlobStore()`, `referencedBlobs(store)`, `collectGarbage(blobs, referenced, opts?)`, `blobUrl(id)`, `parseBlobUrl(src)`, `findBlobRefs(text)`, `dataUriToBlob(uri)`, `blobToBase64(blob)`, `base64ToBlob(data, type)`, `formatStorageBytes(n)`, `BLOB_SCHEME`, `BlobTooLargeError` (`BlobStore`, `BlobInfo`, `StoredBlob`, `BlobUsage`, `CollectGarbageOptions`)
- Block helpers: `blockText(el)`, `imageKey(alt, src)`, `mediaBlockText(keys)`
- `BackupFormatError`, `BACKUP_FORMAT`, `BACKUP_VERSION`, `LEGACY_BACKUP_FORMATS`, `recordTypeForKey(key)`
- `highlightToMarkdown(h, href?)`, `quoteToMarkdown(text, opts?)`, `highlightsToMarkdown(bookTitle, highlights, chapterTitle?)`

**Anchoring and text**

- `resolveAnchor`, `resolveInText`, `quoteFor`, `describeSpan`, `buildTextIndex`
- `rangeToSpan`, `spanToRange`, `selectionSpan`, `offsetFromPoint`, `offsetToPoint`, `pointToOffset`
- `sentenceAt`, `sentenceSpanAt`, `expandToSentences`, `expandSpanToSentences`, `snapToWords`, `CONTEXT_LENGTH`
- `paintHighlights`, `highlightName`, `highlightAtOffset`, `supportsHighlightApi()`

**Blocks**

- `BLOCK_ATTR` (`"data-block-id"`), `IGNORE_ATTR` (`"data-zr-ignore"`), `BLOCK_TAGS`, `BLOCK_TAG_NAMES`
- `ensureBlockIds`, `findBlock`, `blockElementAt`, `blockSpan`, `collectToc`
- `createBlockIdAllocator`, `createSlugger`, `normalizeBlockText`, `hashString`

**Schema and versions**

- `wrap`, `unwrap`, `currentVersion`, `MIGRATIONS`
- `isHighlight`, `isBookmark`, `isAnchor`
- Types: `Envelope`, `RecordType`

**Constants and types**

- `DEFAULT_CLIENT_OPTIONS`, `THEMES`, `TEXT_SIZES`, `LEADINGS`, `MEASURES`, `FONT_FAMILIES`, `HIGHLIGHT_COLORS`
- Types: `BookMeta`, `ChapterMeta`, `TocEntry`, `Anchor`, `Highlight`, `HighlightColor`, `Bookmark`, `BookProgress`, `ChapterProgress`, `Pad`, `PadScope`, `PadScopeKind`, `ReaderSettings`, `ReaderClientOptions`, `ThemeName`, `TextSize`, `Leading`, `Measure`, `FontFamily`, `ISODate`

## Stylesheets

- `zreader/styles.css`: precompiled, for apps without Tailwind
- `zreader/tailwind.css`: for Tailwind v4 and shadcn apps
- `zreader/reader.css`: the reader's own rules (highlights, editor), already included by both of the above

See [Styling](./styling.md).
