import { useMemo, useState } from "react";
import { cn } from "cn";
import { CheckCircle2Icon, SearchIcon, Trash2Icon } from "lucide-react";
import type { BookMeta, Highlight, TocEntry } from "zreader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useBookmarks, useHighlights, useProgress, useReaderStore } from "../context";
import type { LinkComponent } from "../link";
import { chapterMarker, groupByPart } from "../parts";
import { quoteBorderClass } from "../tokens";
import { noteText } from "./blob-image";

export type ContentsTab = "contents" | "highlights" | "bookmarks";

export interface ContentsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tab: ContentsTab;
  onTabChange: (tab: ContentsTab) => void;
  book: BookMeta;
  chapterId: string;
  toc: TocEntry[];
  hrefFor: (chapterId: string, hash?: string) => string;
  Link: LinkComponent;
  orphanedIds: ReadonlySet<string>;
  onJumpHighlight: (id: string) => void;
  onJumpBlock: (blockId: string) => void;
  onJumpHeading: (id: string) => void;
}

const dateFmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export function ContentsSheet(p: ContentsSheetProps) {
  const { book, chapterId, Link } = p;
  const store = useReaderStore();
  const highlights = useHighlights(book.id);
  const bookmarks = useBookmarks(book.id);
  const progress = useProgress(book.id);
  const [query, setQuery] = useState("");

  const titles = useMemo(() => new Map(book.chapters.map((c) => [c.id, c.title])), [book.chapters]);
  const order = useMemo(() => new Map(book.chapters.map((c, i) => [c.id, i])), [book.chapters]);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const groups = new Map<string, Highlight[]>();
    highlights
      .filter((h) => !q || h.anchor.exact.toLowerCase().includes(q) || h.note?.toLowerCase().includes(q))
      .sort((a, b) => (order.get(a.chapterId) ?? 0) - (order.get(b.chapterId) ?? 0) || a.anchor.start - b.anchor.start)
      .forEach((h) => groups.set(h.chapterId, [...(groups.get(h.chapterId) ?? []), h]));
    return groups;
  }, [highlights, query, order]);

  const sortedBookmarks = useMemo(
    () => [...bookmarks].sort((a, b) => (order.get(a.chapterId) ?? 0) - (order.get(b.chapterId) ?? 0)),
    [bookmarks, order],
  );

  const close = () => p.onOpenChange(false);
  /** Same-chapter targets scroll in place; others navigate. */
  const jumpOr = (targetChapter: string, inPage: () => void) => (e: React.MouseEvent) => {
    if (targetChapter !== chapterId) return close();
    e.preventDefault();
    close();
    inPage();
  };

  return (
    <Sheet open={p.open} onOpenChange={p.onOpenChange}>
      <SheetContent side="left" className="w-[88vw] gap-0 p-0 sm:max-w-sm">
        <SheetHeader className="border-b">
          <SheetTitle className="line-clamp-2">{book.title}</SheetTitle>
          {book.authors.length > 0 && <SheetDescription>{book.authors.join(", ")}</SheetDescription>}
        </SheetHeader>
        <Tabs value={p.tab} onValueChange={(v) => p.onTabChange(v as ContentsTab)} className="min-h-0 flex-1 gap-0">
          <div className="px-4 pt-3">
            <TabsList className="w-full">
              <TabsTrigger value="contents">Contents</TabsTrigger>
              <TabsTrigger value="highlights">
                Highlights
                {highlights.length > 0 && <Badge variant="secondary">{highlights.length}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="bookmarks">
                Bookmarks
                {bookmarks.length > 0 && <Badge variant="secondary">{bookmarks.length}</Badge>}
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="contents" className="min-h-0">
            <ScrollArea className="h-full">
              <div className="flex flex-col gap-3 p-2">
                {groupByPart(book.chapters).map((group) => (
                  <section key={group.part ?? "_"} className="flex flex-col gap-0.5">
                    {group.part && <h3 className="px-3 pt-2 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{group.part}</h3>}
                    <ol className="flex flex-col gap-0.5">
                      {group.items.map(({ chapter: c, index: i }) => {
                        const pr = progress.chapters[c.id];
                        const current = c.id === chapterId;
                        return (
                          <li key={c.id}>
                            <Button asChild variant={current ? "secondary" : "ghost"} className="h-auto w-full justify-start gap-3 py-2 text-left whitespace-normal">
                              <Link href={p.hrefFor(c.id)} aria-current={current ? "page" : undefined} onClick={close}>
                                <span className="w-5 shrink-0 text-xs text-muted-foreground tabular-nums">{chapterMarker(c, i)}</span>
                                <span className="flex-1">{c.title}</span>
                                {pr?.completed ? (
                                  <CheckCircle2Icon className="text-primary" aria-label="Completed" />
                                ) : pr ? (
                                  <span className="text-xs text-muted-foreground tabular-nums">{Math.round(pr.percent * 100)}%</span>
                                ) : null}
                              </Link>
                            </Button>
                            {current && p.toc.length > 0 && (
                              <ol className="my-1 ml-8 flex flex-col border-l">
                                {p.toc.map((t) => (
                                  <li key={t.id}>
                                    <Button
                                      asChild
                                      variant="link"
                                      size="sm"
                                      className={cn("h-auto w-full justify-start py-1.5 text-left whitespace-normal text-muted-foreground", t.depth > 2 && "pl-6")}
                                    >
                                      <a href={`#${t.id}`} onClick={jumpOr(chapterId, () => p.onJumpHeading(t.id))}>
                                        {t.text}
                                      </a>
                                    </Button>
                                  </li>
                                ))}
                              </ol>
                            )}
                          </li>
                        );
                      })}
                    </ol>
                  </section>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="highlights" className="flex min-h-0 flex-col">
            {highlights.length > 3 && (
              <div className="px-4 pt-3">
                <div className="relative">
                  <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search highlights and notes" aria-label="Search highlights" className="pl-8" />
                </div>
              </div>
            )}
            <ScrollArea className="min-h-0 flex-1">
              <div className="flex flex-col gap-4 p-4">
                {grouped.size === 0 && (
                  <p className="text-sm text-muted-foreground">
                    {highlights.length ? "No matches." : "Select text — or turn on highlight mode and tap a sentence — to highlight it."}
                  </p>
                )}
                {[...grouped].map(([cid, list]) => (
                  <section key={cid} className="flex flex-col gap-2">
                    <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{titles.get(cid) ?? cid}</h3>
                    <ul className="flex flex-col gap-2">
                      {list.map((h) => (
                        <li key={h.id} className="group flex items-start gap-1">
                          <Link
                            href={p.hrefFor(cid, `hl-${h.id}`)}
                            onClick={jumpOr(cid, () => p.onJumpHighlight(h.id))}
                            className={cn("flex-1 rounded-md border-l-4 bg-muted/40 px-3 py-2 text-sm transition-colors hover:bg-muted", quoteBorderClass(h.color))}
                          >
                            <span className="line-clamp-3 font-serif">{h.anchor.exact}</span>
                            {h.note && <span className="mt-1 line-clamp-2 block text-muted-foreground">{noteText(h.note)}</span>}
                            <span className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                              {dateFmt(h.updatedAt)}
                              {cid === chapterId && p.orphanedIds.has(h.id) && (
                                <Badge variant="outline" title="The passage changed and this highlight could not be placed">
                                  Unplaced
                                </Badge>
                              )}
                            </span>
                          </Link>
                          <Button type="button" variant="ghost" size="icon-sm" aria-label="Delete highlight" onClick={() => store.removeHighlight(book.id, h.id)}>
                            <Trash2Icon />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="bookmarks" className="min-h-0">
            <ScrollArea className="h-full">
              <ul className="flex flex-col gap-2 p-4">
                {sortedBookmarks.length === 0 && <li className="text-sm text-muted-foreground">Use the bookmark button to save your place.</li>}
                {sortedBookmarks.map((b) => (
                  <li key={b.id} className="flex items-start gap-1">
                    <Link
                      href={p.hrefFor(b.chapterId, b.blockId ? `b-${b.blockId}` : undefined)}
                      onClick={b.blockId ? jumpOr(b.chapterId, () => p.onJumpBlock(b.blockId!)) : close}
                      className="flex-1 rounded-md bg-muted/40 px-3 py-2 text-sm transition-colors hover:bg-muted"
                    >
                      <span className="block font-medium">{b.label ?? titles.get(b.chapterId) ?? b.chapterId}</span>
                      {b.excerpt && <span className="mt-0.5 line-clamp-2 block text-muted-foreground">{b.excerpt}</span>}
                      <span className="mt-1 block text-xs text-muted-foreground">{dateFmt(b.createdAt)}</span>
                    </Link>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove bookmark" onClick={() => store.removeBookmark(book.id, b.id)}>
                      <Trash2Icon />
                    </Button>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
