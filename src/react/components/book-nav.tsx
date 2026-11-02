import { cn } from "cn";
import { BookOpenIcon, CheckCircle2Icon, ChevronLeftIcon, CircleIcon } from "lucide-react";
import type { BookMeta } from "zreader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useBook, useBookmarks, useHighlights, useHydrated, useLibrary, useProgress, type HrefFor } from "../context";
import type { LinkComponent } from "../link";
import { chapterMarker, groupByPart } from "../parts";

export interface BookNavProps {
  /** A book id from the provider's catalogue, or the book's metadata. */
  book: BookMeta | string;
  /** Overrides the provider's link component. */
  Link?: LinkComponent;
  /** Overrides the provider's URL builder. */
  hrefFor?: HrefFor;
  className?: string;
}

/** Resolve the book plus link/URL helpers: explicit props win over the provider. */
function useNav(bookArg: BookMeta | string, LinkProp?: LinkComponent, hrefFor?: HrefFor) {
  const library = useLibrary();
  const book = useBook(bookArg);
  const build = hrefFor ?? library.href;
  return {
    book,
    Link: LinkProp ?? library.Link,
    href: (chapterId?: string, hash?: string) => build(book.id, chapterId, hash),
  };
}

/** "Start reading" / "Continue: Chapter 3 · 42%" card for a book page. */
export function ContinueReading({ book: bookArg, Link: LinkProp, hrefFor, className }: BookNavProps) {
  const { book, Link, href } = useNav(bookArg, LinkProp, hrefFor);
  const hydrated = useHydrated();
  const progress = useProgress(book.id);
  const highlights = useHighlights(book.id);
  const bookmarks = useBookmarks(book.id);

  const first = book.chapters[0];
  const lastId = progress.last?.chapterId;
  const last = book.chapters.find((c) => c.id === lastId);
  const done = book.chapters.filter((c) => progress.chapters[c.id]?.completed).length;
  const overall = book.chapters.length ? done / book.chapters.length : 0;
  const lastPct = last ? Math.round((progress.chapters[last.id]?.percent ?? 0) * 100) : 0;

  if (!first) return null;

  return (
    <Card className={cn("gap-4", className)}>
      <CardHeader>
        <CardTitle>{last ? "Continue reading" : "Start reading"}</CardTitle>
        <CardDescription>
          {!hydrated ? <Skeleton className="h-4 w-40" /> : last ? `${last.title} · ${lastPct}%` : `${book.chapters.length} chapters`}
        </CardDescription>
      </CardHeader>
      {hydrated && (done > 0 || highlights.length > 0 || bookmarks.length > 0) && (
        <CardContent className="flex flex-col gap-3">
          <Progress value={Math.round(overall * 100)} aria-label="Book progress" />
          <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
            <Badge variant="secondary">
              {done}/{book.chapters.length} chapters read
            </Badge>
            {highlights.length > 0 && <Badge variant="secondary">{highlights.length} highlights</Badge>}
            {bookmarks.length > 0 && <Badge variant="secondary">{bookmarks.length} bookmarks</Badge>}
          </div>
        </CardContent>
      )}
      <CardFooter>
        <Button asChild className="w-full sm:w-auto">
          <Link href={last ? href(last.id, progress.last?.blockId ? `b-${progress.last.blockId}` : undefined) : href(first.id)}>
            <BookOpenIcon /> {last ? "Continue" : "Start"}
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

/** Chapter list with read state, grouped by `part` when chapters declare one. */
export function ChapterList({ book: bookArg, Link: LinkProp, hrefFor, className }: BookNavProps) {
  const { book, Link, href } = useNav(bookArg, LinkProp, hrefFor);
  const hydrated = useHydrated();
  const progress = useProgress(book.id);
  return (
    <div className={cn("flex flex-col gap-6", className)}>
      {groupByPart(book.chapters).map((group) => (
        <section key={group.part ?? "_"} className="flex flex-col gap-2">
          {group.part && <h3 className="text-sm font-medium text-muted-foreground">{group.part}</h3>}
          <ol className="flex flex-col divide-y overflow-hidden rounded-xl border">
            {group.items.map(({ chapter: c, index: i }) => {
              const pr = hydrated ? progress.chapters[c.id] : undefined;
              return (
                <li key={c.id}>
                  <Button asChild variant="ghost" className="h-auto w-full justify-start gap-4 rounded-none px-4 py-3 text-left whitespace-normal">
                    <Link href={href(c.id)}>
                      <span className="w-6 shrink-0 text-sm text-muted-foreground tabular-nums">{chapterMarker(c, i)}</span>
                      <span className="flex flex-1 flex-col gap-0.5">
                        <span className="font-medium">{c.title}</span>
                        {c.description && <span className="text-sm font-normal text-muted-foreground">{c.description}</span>}
                      </span>
                      {pr?.completed ? (
                        <CheckCircle2Icon className="text-primary" aria-label="Read" />
                      ) : pr ? (
                        <span className="text-xs text-muted-foreground tabular-nums">{Math.round(pr.percent * 100)}%</span>
                      ) : (
                        <CircleIcon className="text-muted-foreground/40" aria-hidden />
                      )}
                    </Link>
                  </Button>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}

export interface BookShelfProps {
  /** Defaults to the provider's catalogue (<ReaderProvider books>). */
  books?: BookMeta[];
  Link?: LinkComponent;
  hrefFor?: HrefFor;
  title?: string;
  description?: string;
  /**
   * Render only the grid, without the full-page shell (background, padding,
   * title), for embedding inside a host site's own page layout.
   */
  embedded?: boolean;
  className?: string;
}

/** Grid of book cards linking to each book's home. */
export function BookShelf({ books: booksProp, Link: LinkProp, hrefFor, title = "Books", description, embedded, className }: BookShelfProps) {
  const library = useLibrary();
  const books = booksProp ?? library.books;
  const Link = LinkProp ?? library.Link;
  const build = hrefFor ?? library.href;
  const hydrated = useHydrated();
  const grid =
    books.length === 0 ? (
      <p className="text-muted-foreground">No books published yet.</p>
    ) : (
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {books.map((book) => (
          <li key={book.id}>
            <BookCard book={book} Link={Link} href={build(book.id)} hydrated={hydrated} />
          </li>
        ))}
      </ul>
    );

  if (embedded) {
    return (
      <div data-zr-reader="" className={cn("text-foreground", className)}>
        {grid}
      </div>
    );
  }

  return (
    <div data-zr-reader="" className={cn("min-h-svh bg-background text-foreground", className)}>
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-16">
        <header className="flex flex-col gap-2">
          <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
          {description && <p className="max-w-prose text-muted-foreground">{description}</p>}
        </header>
        {grid}
      </div>
    </div>
  );
}

function BookCard({ book, Link, href, hydrated }: { book: BookMeta; Link: LinkComponent; href: string; hydrated: boolean }) {
  const progress = useProgress(book.id);
  const done = hydrated ? book.chapters.filter((c) => progress.chapters[c.id]?.completed).length : 0;
  return (
    <Card className="relative h-full gap-4 transition-shadow hover:shadow-md">
      <CardHeader>
        <CardTitle className="font-serif text-xl">
          <Link href={href} className="after:absolute after:inset-0 focus-visible:outline-none">
            {book.title}
          </Link>
        </CardTitle>
        {book.authors.length > 0 && <CardDescription>{book.authors.join(", ")}</CardDescription>}
      </CardHeader>
      {book.description && (
        <CardContent>
          <p className="line-clamp-3 text-sm text-muted-foreground">{book.description}</p>
        </CardContent>
      )}
      <CardFooter className="mt-auto flex items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>{book.chapters.length} chapters</span>
        {done > 0 && <Badge variant="secondary">{done === book.chapters.length ? "Finished" : `${done} read`}</Badge>}
      </CardFooter>
    </Card>
  );
}

export interface BookHomeProps extends BookNavProps {
  /** Back link (e.g. to the shelf). */
  backHref?: string;
  backLabel?: string;
  /**
   * Render only the continue card and chapter list, without the full-page shell
   * or title block, for embedding inside a host site's own page layout.
   */
  embedded?: boolean;
}

/** A book's contents page: title, authors, continue card and chapter list. */
export function BookHome({ book: bookArg, Link: LinkProp, hrefFor, backHref, backLabel = "All books", embedded, className }: BookHomeProps) {
  const { book, Link } = useNav(bookArg, LinkProp, hrefFor);
  if (embedded) {
    return (
      <div data-zr-reader="" className={cn("flex flex-col gap-8 text-foreground", className)}>
        <ContinueReading book={book} Link={Link} hrefFor={hrefFor} />
        <section className="flex flex-col gap-3" aria-labelledby="zr-chapters">
          <h2 id="zr-chapters" className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
            Chapters
          </h2>
          <ChapterList book={book} Link={Link} hrefFor={hrefFor} />
        </section>
      </div>
    );
  }
  return (
    <div data-zr-reader="" className={cn("min-h-svh bg-background text-foreground", className)}>
      <div className="mx-auto flex max-w-3xl flex-col gap-8 px-5 py-8 sm:px-8 sm:py-14">
        {backHref && (
          <Button asChild variant="ghost" size="sm" className="self-start">
            <Link href={backHref}>
              <ChevronLeftIcon /> {backLabel}
            </Link>
          </Button>
        )}
        <header className="flex flex-col gap-3">
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-balance sm:text-5xl">{book.title}</h1>
          {book.subtitle && <p className="font-serif text-xl text-balance text-foreground/80 sm:text-2xl">{book.subtitle}</p>}
          {book.authors.length > 0 && <p className="text-muted-foreground">{book.authors.join(", ")}</p>}
          {book.description && <p className="max-w-prose text-lg text-foreground/80">{book.description}</p>}
        </header>
        <ContinueReading book={book} Link={Link} hrefFor={hrefFor} />
        <section className="flex flex-col gap-3" aria-labelledby="zr-chapters">
          <h2 id="zr-chapters" className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
            Chapters
          </h2>
          <ChapterList book={book} Link={Link} hrefFor={hrefFor} />
        </section>
      </div>
    </div>
  );
}

/** Alias of <BookHome>: a book's contents page. */
export const BookContents = BookHome;
export type BookContentsProps = BookHomeProps;
