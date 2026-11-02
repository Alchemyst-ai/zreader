/**
 * `zreader/next/server` — React Server Components for the optional
 * Next.js adapter. Other React apps wire <ReaderProvider> themselves.
 *
 *   // app/books/layout.tsx — provider with the whole catalogue + next/link
 *   export default function Layout({ children }) { return <ReaderRoot>{children}</ReaderRoot>; }
 *
 *   // app/books/page.tsx            → <BookShelf />
 *   // app/books/[book]/page.tsx     → <BookContents book={params.book} />
 *   // app/books/[book]/[chapter]/page.tsx
 *   export default async function Page({ params }) { return <ReaderChapter {...await params} />; }
 */
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import config from "zreader/virtual-config";
import { getBookMetas, getChapter, getStaticParams, renderChapter, type MdxComponents } from "zreader/content";
import { Callout, Reader, type ReaderProps, type ReaderProviderProps } from "zreader/react";
import { NextReaderProvider } from "zreader/next/client";
import type { BookMeta } from "zreader";

/**
 * Default MDX components (built here, in a server module, so RSC pages get real
 * component references): `<Content components={mdxComponents} />`.
 */
export const mdxComponents = { Callout };

export interface ReaderRootProps extends Omit<ReaderProviderProps, "options" | "store" | "adapter" | "onStorageError" | "Link" | "books" | "headerSlot"> {
  /** Defaults to every book from the content layer (`getBookMetas()`). */
  books?: BookMeta[];
  /**
   * Default content for the middle of the reader's top bar (text or any element).
   * Server-rendered, so it must be a node, not a function.
   */
  headerSlot?: ReactNode;
  children: ReactNode;
}

/**
 * The reader's provider for Next.js: client options from reader.config.ts, the
 * book catalogue from the content layer, and next/link for every link.
 */
export async function ReaderRoot({ books, children, ...props }: ReaderRootProps) {
  const catalogue = books ?? (await getBookMetas());
  return (
    <NextReaderProvider options={config.reader} books={catalogue} {...props}>
      {children}
    </NextReaderProvider>
  );
}

export interface ReaderChapterProps extends Omit<ReaderProps, "book" | "chapter" | "html" | "children" | "toc" | "contentHash" | "Link" | "hrefFor" | "header"> {
  /** Book id (a `[book]` route param). */
  book: string;
  /** Chapter id (a `[chapter]` route param). */
  chapter: string;
  /** Extra MDX components, merged over `mdxComponents`. */
  components?: MdxComponents;
  /** Top-bar content for this chapter only (overrides the provider's). */
  header?: ReactNode;
}

/**
 * Loads, compiles and renders one chapter (Markdown, HTML or MDX) inside <Reader>.
 * Calls `notFound()` for unknown ids. Must be rendered under <ReaderRoot>.
 */
export async function ReaderChapter({ book, chapter, components, ...props }: ReaderChapterProps) {
  const hit = await getChapter(book, chapter);
  if (!hit) notFound();
  const rendered = await renderChapter(hit.chapter);
  return (
    <Reader
      {...props}
      book={book}
      chapter={chapter}
      toc={rendered.toc}
      contentHash={rendered.contentHash}
      html={rendered.kind === "html" ? rendered.html : undefined}
    >
      {rendered.kind === "mdx" ? <rendered.Content components={{ ...mdxComponents, ...components } as MdxComponents} /> : null}
    </Reader>
  );
}

/** `export const generateStaticParams = getBookParams` in `app/books/[book]/page.tsx`. */
export async function getBookParams(): Promise<Array<{ book: string }>> {
  return (await getBookMetas()).map((b) => ({ book: b.id }));
}

/** `export const generateStaticParams = getChapterParams` in `app/books/[book]/[chapter]/page.tsx`. */
export async function getChapterParams(): Promise<Array<{ book: string; chapter: string }>> {
  return getStaticParams();
}

export function getClientOptions() {
  return config.reader;
}

export { config as readerConfig };
