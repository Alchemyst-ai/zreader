import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { cn } from "cn";
import { toast } from "sonner";
import { usePanelRef, useDefaultLayout } from "react-resizable-panels";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BookmarkIcon,
  CheckIcon,
  ChevronLeftIcon,
  HighlighterIcon,
  ListIcon,
  NotebookPenIcon,
  TypeIcon,
} from "lucide-react";
import {
  highlightToMarkdown,
  highlightText,
  quoteToMarkdown,
  supportsHighlightApi,
  BLOCK_ATTR,
  blockText,
  type BookMeta,
  type ChapterMeta,
  type PadScopeKind,
  type TextSpan,
  type TocEntry,
} from "zreader";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { Progress } from "@/components/ui/progress";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ContentsSheet, type ContentsTab } from "./components/contents-sheet";
import { HighlightPanel } from "./components/highlight-panel";
import { ScratchpadPanel, scopeFor } from "./components/scratchpad-panel";
import { SelectionToolbar } from "./components/selection-toolbar";
import { SettingsPanel } from "./components/settings-panel";
import { ImageViewer, useImageViewer } from "./components/image-viewer";
import { useBook, useBookmarks, useIsDesktop, useLibrary, useProgress, useReader, useSettings, type HeaderSlot, type HrefFor } from "./context";
import { copyText } from "./download";
import type { LinkComponent } from "./link";
import { FONT_CLASS, LEADING_CLASS, MEASURE_CLASS, PROSE_CLASS, TEXT_SIZE_CLASS } from "./tokens";
import { useChapterEngine, useValueStore, type ValueStore } from "./useChapterEngine";
import { useChapterRunnables } from "./chapter-runnable";

export interface ReaderProps {
  /** A book id from the provider's catalogue, or the book's metadata. */
  book: BookMeta | string;
  /** A chapter id of that book, or the chapter's metadata. */
  chapter: ChapterMeta | string;
  /** Defaults to the neighbouring chapters in the book. Pass `null` to hide. */
  prev?: ChapterMeta | null;
  next?: ChapterMeta | null;
  /** Contents of this chapter. Defaults to the h2/h3 headings found in the rendered content. */
  toc?: TocEntry[];
  contentHash?: string;
  /** Sanitized chapter HTML (from `renderChapter()` / `renderHtml()` on the server). */
  html?: string;
  /** Or render the chapter yourself (e.g. an MDX component). */
  children?: ReactNode;
  /** Router link, e.g. `next/link`. Defaults to the provider's. */
  Link?: LinkComponent;
  /** Override URL building. Defaults to the provider's. */
  hrefFor?: HrefFor;
  /**
   * Middle of the top bar: a string (shown as text), any element (your logo,
   * a description…), or a function of `{ book, chapter }`. Defaults to the
   * provider's `headerSlot`, then to <ReaderTitle />. Combine freely, e.g.
   * `<><Logo /><ReaderTitle /></>`.
   */
  header?: HeaderSlot;
  /**
   * Buttons for the right side of the top bar, before the bookmark toggle,
   * e.g. `<CopyReference />` from `zreader/agent/react`. Defaults to the
   * provider's `readerActions`; `null` hides them.
   */
  actions?: ReactNode;
  /** Where the back button goes. Defaults to the book page. */
  backHref?: string;
  /** Open block images (`data-zr-zoom`) in a full-screen viewer. Default `true`. */
  lightbox?: boolean;
  className?: string;
}

export interface ReaderChapterValue {
  book: BookMeta;
  chapter: ChapterMeta;
  /** Page URL within this book (the reader's `hrefFor`): `href()` is the book, `href(chapterId)` a chapter. */
  href: (chapterId?: string, hash?: string) => string;
}

const ReaderChapterContext = createContext<ReaderChapterValue | null>(null);

/** The book and chapter of the surrounding <Reader> (for custom header content and actions). */
export function useReaderChapter(): ReaderChapterValue {
  const ctx = useContext(ReaderChapterContext);
  if (!ctx) throw new Error("zreader: useReaderChapter() must be used inside <Reader>.");
  return ctx;
}

/** The default header content: book title over chapter title. */
export function ReaderTitle({ className }: { className?: string }) {
  const { book, chapter } = useReaderChapter();
  return (
    <div className={cn("min-w-0", className)}>
      <p className="truncate text-xs text-muted-foreground">{book.title}</p>
      <p className="truncate text-sm font-medium">{chapter.title}</p>
    </div>
  );
}

function HeaderContent({ slot, book, chapter }: { slot: HeaderSlot | undefined; book: BookMeta; chapter: ChapterMeta }) {
  const content = typeof slot === "function" ? slot({ book, chapter }) : slot;
  if (content === undefined) return <ReaderTitle />;
  if (typeof content === "string" || typeof content === "number") {
    return <p className="truncate text-sm font-medium">{content}</p>;
  }
  return <>{content}</>;
}

function ReadingProgress({ store, className }: { store: ValueStore; className?: string }) {
  const value = useValueStore(store);
  return <Progress value={Math.round(value * 100)} aria-label="Chapter progress" className={cn("h-0.5 rounded-none bg-transparent", className)} />;
}

function IconAction({ label, children, ...props }: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label={label} {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function IconToggle({ label, children, ...props }: React.ComponentProps<typeof Toggle> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle aria-label={label} {...props}>
          {children}
        </Toggle>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Hide the header while scrolling down (mobile, window scroll). */
function useAutoHide(enabled: boolean) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setHidden(false);
      return;
    }
    let last = window.scrollY;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const y = window.scrollY;
        if (Math.abs(y - last) < 8) return;
        setHidden(y > last && y > 80);
        last = y;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [enabled]);
  return hidden;
}

const isEditable = (el: Element | null) => !!el?.closest("input,textarea,select,[contenteditable='true']");

export function Reader({
  book: bookArg,
  chapter: chapterArg,
  prev: prevArg,
  next: nextArg,
  toc: tocProp,
  contentHash,
  html,
  children,
  Link: LinkProp,
  hrefFor,
  header,
  actions,
  backHref,
  lightbox = true,
  className,
}: ReaderProps) {
  const { store, options } = useReader();
  const library = useLibrary();
  const book = useBook(bookArg);
  const chapterIndex = book.chapters.findIndex((c) => c.id === (typeof chapterArg === "string" ? chapterArg : chapterArg.id));
  const chapter: ChapterMeta | undefined = typeof chapterArg === "string" ? book.chapters[chapterIndex] : chapterArg;
  if (!chapter) {
    throw new Error(`zreader: book "${book.id}" has no chapter "${String(chapterArg)}".`);
  }
  const prev = prevArg !== undefined ? prevArg : (book.chapters[chapterIndex - 1] ?? null);
  const next = nextArg !== undefined ? nextArg : chapterIndex >= 0 ? (book.chapters[chapterIndex + 1] ?? null) : null;
  const Link = LinkProp ?? library.Link;
  const slot = header !== undefined ? header : library.headerSlot;
  const topActions = actions !== undefined ? actions : library.readerActions;
  const [settings, updateSettings] = useSettings();
  const isDesktop = useIsDesktop();
  const bookmarks = useBookmarks(book.id);
  const progress = useProgress(book.id);

  const build = hrefFor ?? library.href;
  const href = useCallback((chapterId?: string, hash?: string) => build(book.id, chapterId, hash), [build, book.id]);
  const chapterCtx = useMemo<ReaderChapterValue>(() => ({ book, chapter, href }), [book, chapter, href]);

  // Callback-ref state: the article remounts when the layout switches (mobile ↔ desktop).
  const [rootEl, setRootEl] = useState<HTMLElement | null>(null);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const [contentsOpen, setContentsOpen] = useState(false);
  const [contentsTab, setContentsTab] = useState<ContentsTab>("contents");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [padOpen, setPadOpen] = useState(false);
  const [padKind, setPadKind] = useState<PadScopeKind>(options.scratchpad.scopes[0] ?? "chapter");
  const [padSnap, setPadSnap] = useState<number | string | null>(0.55);
  const [openHighlightId, setOpenHighlightId] = useState<string | null>(null);
  const [focusNote, setFocusNote] = useState(false);

  const engine = useChapterEngine({
    bookId: book.id,
    chapterId: chapter.id,
    contentHash,
    root: rootEl,
    scroller: isDesktop ? scrollEl : null,
    topOffset: isDesktop ? 16 : 64,
    onHighlightTap: (id) => {
      setFocusNote(false);
      setOpenHighlightId(id);
    },
  });

  const viewer = useImageViewer(rootEl, lightbox);

  // Prefer the build-time TOC; otherwise use the headings found in the rendered content.
  const toc = tocProp && tocProp.length > 0 ? tocProp : engine.domToc;

  const headerHidden = useAutoHide(!isDesktop && !engine.selection);
  const chapterBookmarks = useMemo(() => bookmarks.filter((b) => b.chapterId === chapter.id), [bookmarks, chapter.id]);
  const completed = progress.chapters[chapter.id]?.completed ?? false;
  const openHighlight = engine.highlights.find((h) => h.id === openHighlightId) ?? null;
  const orphanedIds = useMemo(() => new Set(engine.orphaned.map((h) => h.id)), [engine.orphaned]);
  const padEnabled = options.scratchpad.enabled;

  // ------------------------------------------------------------ one-offs
  useEffect(() => {
    if (!supportsHighlightApi()) {
      toast.info("Highlights can't be drawn in this browser", { description: "They are still saved and listed under Contents → Highlights." });
    }
  }, []);

  useEffect(() => {
    if (!engine.resume) return;
    toast(`Resumed at ${Math.round(engine.resume.percent * 100)}%`, {
      id: `zr-resume-${chapter.id}`,
      action: { label: "Start from top", onClick: () => engine.scrollToTop() },
    });
    engine.dismissResume();
  }, [engine.resume, engine, chapter.id]);

  // ------------------------------------------------------------- actions
  const openPad = useCallback(() => {
    setPadOpen(true);
    setPadSnap(0.55);
  }, []);

  const quoteToPad = useCallback(
    (markdown: string) => {
      store.appendToPad(scopeFor(padKind, book.id, chapter.id), markdown);
      openPad();
      toast.success("Added to scratchpad");
    },
    [store, padKind, book.id, chapter.id, openPad],
  );

  // RunnableCode the author wrote: Copy to scratchpad goes to the chapter pad.
  const chapterPad = padEnabled && options.scratchpad.scopes.includes("chapter");
  useChapterRunnables(rootEl, {
    bookId: book.id,
    chapterId: chapter.id,
    contentKey: html ?? contentHash,
    copyToPad: chapterPad
      ? (markdown) => {
          store.appendToPad(scopeFor("chapter", book.id, chapter.id), markdown);
          setPadKind("chapter");
          openPad();
          toast.success("Copied to the chapter's scratchpad");
        }
      : undefined,
  });

  const quoteSpan = (span: TextSpan, text: string) => {
    const h = engine.createHighlight(span);
    engine.clearSelection();
    quoteToPad(h ? highlightToMarkdown(h, href(chapter.id, `hl-${h.id}`)) : quoteToMarkdown(text));
  };

  const copy = async (text: string) => {
    toast((await copyText(text)) ? "Copied" : "Could not copy");
  };

  const toggleBookmark = () => {
    if (chapterBookmarks.length) {
      const removed = chapterBookmarks;
      removed.forEach((b) => store.removeBookmark(book.id, b.id));
      toast("Bookmark removed", {
        action: {
          label: "Undo",
          onClick: () =>
            removed.forEach((b) =>
              store.addBookmark({ bookId: b.bookId, chapterId: b.chapterId, blockId: b.blockId, label: b.label, excerpt: b.excerpt }),
            ),
        },
      });
      return;
    }
    const block = engine.getTopBlock();
    store.addBookmark({
      bookId: book.id,
      chapterId: chapter.id,
      ...(block ? { blockId: block.getAttribute(BLOCK_ATTR) ?? undefined, excerpt: blockText(block).slice(0, 120) } : {}),
      label: chapter.title,
    });
    toast.success("Bookmarked", { description: "Find it under Contents → Bookmarks." });
  };

  // Keyboard: with a selection, `h` highlights and `n` adds a note.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!engine.selection || e.metaKey || e.ctrlKey || e.altKey || isEditable(document.activeElement)) return;
      if (e.key === "h") {
        e.preventDefault();
        engine.createHighlight(engine.selection.span);
        engine.clearSelection();
      } else if (e.key === "n") {
        e.preventDefault();
        const h = engine.createHighlight(engine.selection.span);
        engine.clearSelection();
        if (h) {
          setFocusNote(true);
          setOpenHighlightId(h.id);
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [engine]);

  // --------------------------------------------------------------- pieces
  const topBar = (
    <header
      className={cn(
        "sticky top-0 z-30 border-b bg-background/85 backdrop-blur-md transition-transform duration-200 supports-[backdrop-filter]:bg-background/70",
        headerHidden && "-translate-y-full",
      )}
    >
      <div className="flex h-14 items-center gap-1 px-2 pt-[env(safe-area-inset-top)] sm:px-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button asChild variant="ghost" size="icon" aria-label="Back to book">
              <Link href={backHref ?? href()}>
                <ChevronLeftIcon />
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Back to book</TooltipContent>
        </Tooltip>
        <IconAction label="Contents, highlights and bookmarks" onClick={() => setContentsOpen(true)}>
          <ListIcon />
        </IconAction>
        <div className="flex min-w-0 flex-1 items-center gap-2 px-1">
          <HeaderContent slot={slot} book={book} chapter={chapter} />
        </div>
        {topActions}
        <IconToggle label={chapterBookmarks.length ? "Remove bookmark" : "Bookmark this place"} pressed={chapterBookmarks.length > 0} onPressedChange={toggleBookmark} className="data-[state=on]:[&_svg]:fill-current">
          <BookmarkIcon />
        </IconToggle>
        <IconToggle label="Highlight mode: tap a sentence" pressed={settings.highlightMode} onPressedChange={(highlightMode) => updateSettings({ highlightMode })}>
          <HighlighterIcon />
        </IconToggle>
        <IconAction label="Reading settings" onClick={() => setSettingsOpen(true)}>
          <TypeIcon />
        </IconAction>
        {padEnabled && (
          <IconToggle label="Scratchpad" pressed={padOpen} onPressedChange={(open) => (open ? openPad() : setPadOpen(false))}>
            <NotebookPenIcon />
          </IconToggle>
        )}
      </div>
      <ReadingProgress store={engine.percentStore} className="absolute inset-x-0 bottom-0" />
    </header>
  );

  const body = (
    <div className={cn("mx-auto w-full px-5 pt-8 pb-[calc(7rem+env(safe-area-inset-bottom))] sm:px-8 lg:pt-12", MEASURE_CLASS[settings.measure])}>
      <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
        {chapter.part && <span>{chapter.part}</span>}
        {chapter.part && <span aria-hidden="true">·</span>}
        <span>{chapter.label ?? `Chapter ${chapterIndex + 1} of ${book.chapters.length}`}</span>
      </p>
      <h1 className={cn("mt-1 text-3xl font-semibold tracking-tight text-balance sm:text-4xl", FONT_CLASS[settings.fontFamily])}>{chapter.title}</h1>
      <article
        ref={setRootEl}
        className={cn("mt-8", PROSE_CLASS, TEXT_SIZE_CLASS[settings.textSize], LEADING_CLASS[settings.leading], FONT_CLASS[settings.fontFamily], settings.highlightMode && "cursor-pointer")}
        aria-label={chapter.title}
      >
        {html !== undefined ? <div dangerouslySetInnerHTML={{ __html: html }} /> : children}
      </article>

      <footer className="mt-16 flex flex-col gap-4 border-t pt-8">
        {!completed && (
          <Button type="button" variant="outline" className="self-center" onClick={() => store.markChapterComplete(book.id, chapter.id)}>
            <CheckIcon /> Mark chapter as read
          </Button>
        )}
        <nav aria-label="Chapters" className="grid grid-cols-2 gap-3">
          {prev ? (
            <Button asChild variant="ghost" className="h-auto flex-col items-start gap-1 py-3 text-left whitespace-normal">
              <Link href={href(prev.id)}>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <ArrowLeftIcon /> Previous
                </span>
                <span className="line-clamp-2 font-medium">{prev.title}</span>
              </Link>
            </Button>
          ) : (
            <span />
          )}
          {next ? (
            <Button asChild variant="secondary" className="col-start-2 h-auto flex-col items-end gap-1 py-3 text-right whitespace-normal">
              <Link href={href(next.id)}>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  Next <ArrowRightIcon />
                </span>
                <span className="line-clamp-2 font-medium">{next.title}</span>
              </Link>
            </Button>
          ) : null}
        </nav>
      </footer>
    </div>
  );

  const pad = (onClose: () => void) => (
    <ScratchpadPanel
      bookId={book.id}
      chapterId={chapter.id}
      kind={padKind}
      onKindChange={setPadKind}
      onClose={onClose}
      onEditorFocus={() => setPadSnap(0.95)}
      title={book.id}
    />
  );

  const padPanelRef = usePanelRef();
  // Persist the desktop split through the reader's own (SSR-safe) storage adapter.
  const layoutStorage = useMemo(
    () => ({ getItem: (k: string) => store.adapter.get(k), setItem: (k: string, v: string) => store.adapter.set(k, v) }),
    [store],
  );
  const layout = useDefaultLayout({ id: `${options.storagePrefix}:v1:layout`, panelIds: ["content", "pad"], storage: layoutStorage });
  useEffect(() => {
    const p = padPanelRef.current;
    if (!isDesktop || !p) return;
    if (padOpen && p.isCollapsed()) p.expand();
    if (!padOpen && !p.isCollapsed()) p.collapse();
  }, [padOpen, isDesktop, padPanelRef]);

  return (
    <ReaderChapterContext.Provider value={chapterCtx}>
    <div data-zr-reader="" className={cn("min-h-svh bg-background text-foreground", isDesktop && "flex h-svh flex-col overflow-hidden", className)}>
      {topBar}

      {isDesktop ? (
        <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1" defaultLayout={layout.defaultLayout} onLayoutChanged={layout.onLayoutChanged}>
          <ResizablePanel id="content" minSize="40%">
            <div ref={setScrollEl} className="h-full overflow-y-auto overscroll-contain">
              {body}
            </div>
          </ResizablePanel>
          {padEnabled && (
            <>
              <ResizableHandle withHandle className={cn(!padOpen && "hidden")} />
              <ResizablePanel
                id="pad"
                panelRef={padPanelRef}
                collapsible
                collapsedSize="0%"
                defaultSize={padOpen ? "32%" : "0%"}
                minSize="22%"
                maxSize="55%"
                onResize={(size) => setPadOpen(size.asPercentage > 0)}
                className="bg-background"
              >
                {padOpen && pad(() => setPadOpen(false))}
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      ) : (
        <main>{body}</main>
      )}

      {!isDesktop && padEnabled && (
        <Drawer open={padOpen} onOpenChange={setPadOpen} snapPoints={[0.55, 0.95]} activeSnapPoint={padSnap} setActiveSnapPoint={setPadSnap} repositionInputs={false}>
          <DrawerContent className="h-[95svh] max-h-[95svh]">
            <DrawerTitle className="sr-only">Scratchpad</DrawerTitle>
            <DrawerDescription className="sr-only">Notes and checklists saved in this browser.</DrawerDescription>
            <div className="flex min-h-0 flex-1 flex-col pb-[env(safe-area-inset-bottom)]">{pad(() => setPadOpen(false))}</div>
          </DrawerContent>
        </Drawer>
      )}

      <ImageViewer image={viewer.image} onClose={viewer.close} returnFocus={viewer.trigger} />

      <SelectionToolbar
        selection={openHighlightId || settingsOpen || contentsOpen ? null : engine.selection}
        colors={options.highlightColors}
        onHighlight={(span, color) => {
          engine.createHighlight(span, color);
          engine.clearSelection();
        }}
        onSentence={(span) => engine.expandSelectionToSentences(span)}
        onNote={(span) => {
          const h = engine.createHighlight(span);
          engine.clearSelection();
          if (h) {
            setFocusNote(true);
            setOpenHighlightId(h.id);
          }
        }}
        onQuote={padEnabled ? quoteSpan : undefined}
        onCopy={(text) => {
          void copy(text);
          engine.clearSelection();
        }}
        onDismiss={engine.clearSelection}
      />

      <HighlightPanel
        highlight={openHighlight}
        colors={options.highlightColors}
        focusNote={focusNote}
        onColor={(color) => openHighlight && store.updateHighlight(book.id, openHighlight.id, { color })}
        onNote={(note) => openHighlight && store.updateHighlight(book.id, openHighlight.id, { note })}
        onDelete={() => {
          if (!openHighlight) return;
          const removed = openHighlight;
          store.removeHighlight(book.id, removed.id);
          setOpenHighlightId(null);
          engine.setActiveId(null);
          toast("Highlight deleted", {
            action: {
              label: "Undo",
              onClick: () => store.addHighlight({ bookId: removed.bookId, chapterId: removed.chapterId, anchor: removed.anchor, color: removed.color, note: removed.note }),
            },
          });
        }}
        onQuote={padEnabled && openHighlight ? () => quoteToPad(highlightToMarkdown(openHighlight, href(chapter.id, `hl-${openHighlight.id}`))) : undefined}
        onCopy={openHighlight ? () => void copy(highlightText(openHighlight)) : undefined}
        onClose={() => {
          setOpenHighlightId(null);
          setFocusNote(false);
          engine.setActiveId(null);
        }}
      />

      <ContentsSheet
        open={contentsOpen}
        onOpenChange={setContentsOpen}
        tab={contentsTab}
        onTabChange={setContentsTab}
        book={book}
        chapterId={chapter.id}
        toc={toc}
        hrefFor={(c, h) => href(c, h)}
        Link={Link}
        orphanedIds={orphanedIds}
        onJumpHighlight={(id) => engine.scrollToHighlight(id)}
        onJumpBlock={(id) => engine.scrollToBlock(id)}
        onJumpHeading={(id) => engine.scrollToHeading(id)}
      />

      <SettingsPanel open={settingsOpen} onOpenChange={setSettingsOpen} book={book} />
    </div>
    </ReaderChapterContext.Provider>
  );
}
