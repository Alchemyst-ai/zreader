# API reference

Every entry point and what it exports. Types are listed after values. For behaviour, follow the links to the guides.

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
- `Callout` (`CalloutProps`)
- Building blocks: `ContentsSheet` (`ContentsSheetProps`, `ContentsTab`), `HighlightPanel`, `SelectionToolbar`, `SettingsPanel`, `ScratchpadPanel`, `scopeFor`, `scopeKey`, `ResponsivePanel`

**Hooks**

- `useSettings()`, `useHighlights(bookId, chapterId?)`, `useBookmarks(bookId)`, `useProgress(bookId)`, `usePad(scope)`
- `useHydrated()`, `useMediaQuery(query, serverValue?)`, `useIsDesktop()`
- `useChapterEngine(options)` (`ChapterEngine`, `ChapterEngineOptions`, `SelectionState`), `useValueStore(store)`

**Utilities**

- `DefaultLink`, `defaultHref(basePath, bookId, chapterId?, hash?)`, `LinkComponent`
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

- `createAgentHandler(options?)`: `(request: Request) => Promise<Response | undefined>`
- `matchAgentRoute(pathname, basePath, llms?)`, `requestOrigin(request)`
- `chapterToMarkdown(lookup, ctx)`, `bookToMarkdown(book, ctx)`, `shelfToMarkdown(books, ctx)`, `llmsTxt(books, ctx, opts?)`
- `chapterBodyToMarkdown(entry)`, `mdxToMarkdown(source)`, `htmlToMarkdown(html)`
- `pageUrl(ctx, book?, chapter?)`, `markdownPageUrl(ctx, book?, chapter?)`
- Types: `AgentHandler`, `AgentHandlerOptions` (`basePath`, `api`, `origin`, `llms`, `cacheControl`), `AgentContentSource`, `AgentUrlContext` (`{ origin, basePath }`), `LlmsTxtOptions` (`{ title?, description? }`)

Browser bundles resolve this entry to a stub that throws.

## `zreader/content`

Node. See [Content layer](./content.md).

- `getBooks()`, `getBookMetas()`, `getBook(id)`, `getChapter(bookId, chapterId)`, `renderChapter(entry)`, `getStaticParams(names?)`, `getReaderConfig()`
- `defineBooks(contentOptions | resolvedConfig)`: a separate API with the same methods
- `toBookMeta(bookEntry)`, `loadBooks(config)`, `compileChapter(entry, config)`, `ContentError`
- `renderMarkdown(md, opts?)`, `renderHtml(html, opts?)`, `annotateHtml(html)`, `compileMdx(source, opts?)`, `runMdx(code)`, `sanitizeHtml(html, sanitize?)`
- `rehypeBlocks`, `hashString`, `glob`, `defineConfig`, `z`
- Types: `BookEntry`, `ChapterEntry`, `ChapterLookup`, `RenderedChapter`, `HtmlResult`, `MdxCompiled`, `MdxContent`, `MdxComponents`, `ChapterFormat`, `PipelineOptions`, `BlockInfo`, `BlocksData`, `ReaderUserConfig`, `ResolvedReaderConfig`, `SanitizeOptions`, `ContentConfig`, `GlobLoader`

Browser bundles resolve this entry to a stub that throws.

## `zreader/config`

Node (ESM and CJS). See [Configuration](./configuration.md).

- `defineConfig(config)`, `glob({ base, pattern?, ignore? })`, `z` (zod v4)
- `resolveConfig(user?, inline?, { root?, source? })`, `mergeConfig(base, ...overrides)`, `clientOptions(resolved)`
- `defaultContentConfig()`, `defaultBookSchema`, `defaultChapterSchema`
- `ReaderConfigError` (with `issues: { path, message }[]`), `CONFIG_FILE_NAMES`
- Types: `ReaderUserConfig`, `ResolvedReaderConfig`, `ContentConfig`, `GlobLoader`, `SanitizeOptions`, `PluginList`

## `zreader/next`

Node (ESM and CJS), for `next.config.*`. See [Next.js](./nextjs.md).

- `withReader(nextConfig?, options?)` (`WithReaderOptions`: `configPath`, `root`, `config`, `verbose`)
- `setupReader(options?)`, `applyReaderConfig(base, setup, root)`: the pieces of `withReader`, exported for testing and custom setups
- `resolveConfig`, `findConfigFile(root)`, `loadConfigFile(file)`
- `USER_CONFIG_SPECIFIER`, `EMPTY_CONFIG_SPECIFIER`, `SERVER_EXTERNALS`

## `zreader/next/server`

React Server Components.

- `ReaderRoot` (`ReaderRootProps`, `ReaderRootAgentOptions`)
- `ReaderChapter` (`ReaderChapterProps`)
- `getBookParams()`, `getChapterParams()`
- `mdxComponents`, `readerConfig`, `getClientOptions()`

## `zreader/next/client`

Browser.

- `NextReaderProvider` (`NextReaderProviderProps`): `ReaderProvider` with `Link` bound to `next/link`

## `zreader/editor`

Browser. Lazy-loaded by the scratchpad; import it directly only for a custom editor UI.

- `ScratchpadEditor` (default export too) with `ScratchpadEditorProps`: `scope`, `placeholder?`, `autoFocus?`, `onFocus?`, `className?`

Needs the Tiptap peer dependencies.

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
