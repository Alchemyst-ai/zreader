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
 *
 * With more than one bookshelf, pass `shelf` (one `app/` folder per shelf).
 */
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import config from "zreader/virtual-config";
import { getShelf, type MdxComponents } from "zreader/content";
import { Callout, Reader, type ReaderProps, type ReaderProviderProps } from "zreader/react";
import { NextReaderProvider } from "zreader/next/client";
import { CopyReference, MarkdownAlternate, type BuiltInProvider } from "zreader/agent/react";
import type { BookMeta } from "zreader";
import type { ResolvedShelf } from "zreader/config";

/**
 * Default MDX components (built here, in a server module, so RSC pages get real
 * component references): `<Content components={mdxComponents} />`.
 */
export const mdxComponents = { Callout };

/** Serializable options for `<ReaderRoot agent>` (see `<CopyReference>`). */
export interface ReaderRootAgentOptions {
  /** Copied text; `{url}` is the chapter's `.md` URL. */
  prompt?: string;
  /** Prompt sent to the assistants in the menu. */
  askPrompt?: string;
  /** Built-in assistants, in order. `[]` hides them. */
  providers?: BuiltInProvider[];
  /** Button text. */
  label?: string;
}

export interface ReaderRootProps
  extends Omit<ReaderProviderProps, "options" | "store" | "adapter" | "onStorageError" | "Link" | "books" | "headerSlot" | "readerActions"> {
  /** Bookshelf id. Defaults to the first shelf in reader.config.ts. */
  shelf?: string;
  /** Defaults to every book on the shelf (`getShelf(shelf).getBookMetas()`). */
  books?: BookMeta[];
  /**
   * Default content for the middle of the reader's top bar (text or any element).
   * Server-rendered, so it must be a node, not a function.
   */
  headerSlot?: ReactNode;
  /**
   * Default buttons for the right of the reader's top bar. A chapter's
   * `actions` replaces them. With `agent`, they render after the agent button.
   */
  readerActions?: ReactNode;
  /**
   * Agent features for every chapter: a `<link rel="alternate" type="text/markdown">`
   * tag and a "Copy reference" button pointing at the chapter's `.md` twin.
   * Serve those with `createAgentHandler()` from `zreader/agent` in proxy.ts.
   */
  agent?: boolean | ReaderRootAgentOptions;
  /** Log the development warning (§10.2) when the proxy matcher misses this shelf. */
  devWarnings?: boolean;
  children: ReactNode;
}

/**
 * The proxy matcher a shelf needs (§10.4). Next.js requires `config.matcher` to
 * be a static literal, so this only documents what it should say — the
 * development warning quotes it when the routes 404.
 */
export function agentMatcher(shelf: ResolvedShelf): string[] {
  const base = shelf.basePath.replace(/\/+$/, "");
  const out = [base ? `${base}.md` : "/index.md", `${base}/:path*.md`];
  for (const plugin of shelf.plugins) {
    for (const route of plugin.routes ?? []) {
      if (route.path === "*") continue;
      out.push(`${base}${route.path}`);
    }
    for (const route of plugin.rootRoutes ?? []) out.push(route.path);
  }
  return [...new Set(out)];
}

const probed = new Set<string>();

/**
 * §10.2: `<ReaderRoot agent>` links to `.md` twins. If the proxy matcher does
 * not cover this shelf, those links 404 — so probe once, in the background.
 */
async function probeAgent(shelf: ResolvedShelf, matcher: string[]) {
  if (process.env.NODE_ENV !== "development") return;
  if (probed.has(shelf.id)) return;
  probed.add(shelf.id);
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (!host) return;
    const local = /^(localhost|127\.0\.0\.1)/.test(host);
    const proto = h.get("x-forwarded-proto") ?? (local ? "http" : "https");
    const base = shelf.basePath.replace(/\/+$/, "");
    const res = await fetch(`${proto}://${host}${base ? `${base}.md` : "/index.md"}`, { method: "HEAD", cache: "no-store" });
    if (res.headers.get("x-zreader-shelf")) return;
    console.warn(
      `[zreader] <ReaderRoot shelf="${shelf.id}" agent> links to ${shelf.basePath}/*.md, but ${base ? `${base}.md` : "/index.md"}\n` +
        `          is not served by createAgentHandler(). Add these to the matcher in proxy.ts:\n` +
        `            ${matcher.map((m) => `"${m}"`).join(", ")}`,
    );
  } catch {
    /* best effort: never fail a render over a warning */
  }
}

/**
 * The reader's provider for Next.js: the shelf's client options from
 * reader.config.ts, its book catalogue from the content layer, and next/link for
 * every link.
 */
export async function ReaderRoot({ books, agent, shelf, devWarnings = true, readerActions, children, ...props }: ReaderRootProps) {
  const api = getShelf(shelf);
  const resolved = await api.shelf();
  const catalogue = books ?? (await api.getBookMetas());
  const agentOptions = agent === true ? {} : agent || null;
  if (agentOptions && devWarnings) void probeAgent(resolved, agentMatcher(resolved));
  const actions = agentOptions ? (
    <>
      <MarkdownAlternate />
      <CopyReference markdown {...agentOptions} />
      {readerActions}
    </>
  ) : (
    readerActions
  );
  return (
    <NextReaderProvider options={resolved.reader} books={catalogue} readerActions={actions} {...props}>
      {children}
    </NextReaderProvider>
  );
}

export interface ReaderChapterProps extends Omit<ReaderProps, "book" | "chapter" | "html" | "children" | "toc" | "contentHash" | "Link" | "hrefFor" | "header"> {
  /** Book id (a `[book]` route param). */
  book: string;
  /** Chapter id (a `[chapter]` route param). */
  chapter: string;
  /** Bookshelf id. Defaults to the first shelf in reader.config.ts. */
  shelf?: string;
  /** Extra MDX components, merged over `mdxComponents`. */
  components?: MdxComponents;
  /** Top-bar content for this chapter only (overrides the provider's). */
  header?: ReactNode;
}

/**
 * Loads, compiles and renders one chapter (Markdown, HTML or MDX) inside <Reader>.
 * Calls `notFound()` for unknown ids. Must be rendered under <ReaderRoot>.
 */
export async function ReaderChapter({ book, chapter, shelf, components, ...props }: ReaderChapterProps) {
  const api = getShelf(shelf);
  const hit = await api.getChapter(book, chapter);
  if (!hit) notFound();
  const rendered = await api.renderChapter(hit.chapter);
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

/** `export const generateStaticParams = () => getBookParams("reports")` in `app/reports/[book]/page.tsx`. */
export async function getBookParams(shelf?: string): Promise<Array<{ book: string }>> {
  return (await getShelf(shelf).getBookMetas()).map((b) => ({ book: b.id }));
}

/** `export const generateStaticParams = () => getChapterParams("reports")` in `app/reports/[book]/[chapter]/page.tsx`. */
export async function getChapterParams(shelf?: string): Promise<Array<{ book: string; chapter: string }>> {
  return getShelf(shelf).getStaticParams();
}

/** Client options for one shelf (defaults to the first). */
export function getClientOptions(shelf?: string) {
  if (!shelf) return config.reader;
  const found = config.shelves.find((s) => s.id === shelf);
  if (!found) {
    throw new Error(`zreader: no bookshelf with id "${shelf}". Known: ${config.shelves.map((s) => s.id).join(", ")}.`);
  }
  return found.reader;
}

export { config as readerConfig };
export type { ResolvedShelf };
