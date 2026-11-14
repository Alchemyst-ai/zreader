/**
 * Chapter / book / shelf → plain Markdown for agents (LLMs, crawlers, CLIs).
 * Server-only: reads the content layer's raw chapter sources.
 */
import rehypeParse from "rehype-parse";
import rehypeRemark from "rehype-remark";
import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import type { BookEntry, ChapterEntry, ChapterLookup } from "zreader/content";
import type { BookMeta, ChapterMeta } from "zreader";

/** Where the reader lives: absolute origin + the reader's basePath. */
export interface AgentUrlContext {
  /** e.g. "https://press.example.com" (no trailing slash). */
  origin: string;
  /** The reader's basePath, e.g. "/books". */
  basePath: string;
}

export interface LlmsTxtOptions {
  /** H1 of llms.txt. Defaults to the book title (one book) or "Books". */
  title?: string;
  /** Summary line of llms.txt. */
  description?: string;
}

// ---------------------------------------------------------------- URLs

function base(basePath: string) {
  return basePath.replace(/\/+$/, "");
}

/** Page URL of the shelf, a book, or a chapter. */
export function pageUrl(ctx: AgentUrlContext, book?: string, chapter?: string): string {
  let path = base(ctx.basePath);
  if (book) path += `/${encodeURIComponent(book)}`;
  if (book && chapter) path += `/${encodeURIComponent(chapter)}`;
  return `${ctx.origin}${path || "/"}`;
}

/** `.md` URL of the shelf, a book, or a chapter. */
export function markdownPageUrl(ctx: AgentUrlContext, book?: string, chapter?: string): string {
  if (!book && !base(ctx.basePath)) return `${ctx.origin}/index.md`;
  return `${pageUrl(ctx, book, chapter)}.md`;
}

// ---------------------------------------------------------------- conversion

type Node = { type: string; children?: Node[]; [k: string]: unknown };
type JsxAttribute = { type: string; name?: string; value?: unknown };

const MDX_DROP = new Set(["mdxjsEsm", "mdxFlowExpression", "mdxTextExpression"]);

function jsxAttr(node: Node, name: string): string | undefined {
  const attrs = (node.attributes as JsxAttribute[] | undefined) ?? [];
  const a = attrs.find((x) => x.type === "mdxJsxAttribute" && x.name === name);
  return typeof a?.value === "string" ? a.value : undefined;
}

/** Embedded documents and media: kept as a link so agents can still fetch them (PDFs etc.). */
const EMBED_SRC: Record<string, string> = { embed: "src", iframe: "src", object: "data", video: "src", audio: "src", source: "src" };

/** Link text for an embedded file: its title, else its file name. */
function fileLabel(url: string, title?: string): string {
  if (title) return title;
  const last = url.split(/[?#]/)[0]!.split("/").filter(Boolean).pop() ?? url;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

function trimTrailingSpace(out: Node[]) {
  const prev = out[out.length - 1];
  if (prev?.type === "text") prev.value = String(prev.value).replace(/[ \t]+$/, "");
}

/** Replace MDX-only nodes with plain Markdown equivalents (or their children). */
function stripMdx(nodes: Node[]): Node[] {
  const out: Node[] = [];
  for (let node of nodes) {
    if (MDX_DROP.has(node.type)) {
      // `a {expr} b` → `a b`, not `a  b`.
      if (node.type === "mdxTextExpression") trimTrailingSpace(out);
      continue;
    }
    // A paragraph holding only one JSX element (`<Callout>One line.</Callout>`) is a block.
    const only = node.type === "paragraph" && node.children?.length === 1 ? node.children[0]! : null;
    if (only?.type === "mdxJsxTextElement") {
      node = { ...only, type: "mdxJsxFlowElement", children: only.children?.length ? [{ type: "paragraph", children: only.children }] : [] };
    }
    const children = node.children ? stripMdx(node.children) : undefined;
    if (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") {
      const name = typeof node.name === "string" ? node.name : "";
      const flow = node.type === "mdxJsxFlowElement";
      if (name === "Callout" && flow) {
        const title = jsxAttr(node, "title");
        const heading: Node[] = title
          ? [{ type: "paragraph", children: [{ type: "strong", children: [{ type: "text", value: title }] }] }]
          : [];
        out.push({ type: "blockquote", children: [...heading, ...(children ?? [])] });
      } else if (name === "img") {
        const url = jsxAttr(node, "src");
        if (url) {
          const img: Node = { type: "image", url, alt: jsxAttr(node, "alt") ?? "", title: jsxAttr(node, "title") ?? null };
          out.push(flow ? { type: "paragraph", children: [img] } : img);
        }
      } else if (name === "a" && jsxAttr(node, "href")) {
        const link: Node = { type: "link", url: jsxAttr(node, "href"), children: children ?? [] };
        out.push(flow ? { type: "paragraph", children: [link] } : link);
      } else if (name === "br") {
        out.push({ type: "break" });
      } else if (EMBED_SRC[name] && jsxAttr(node, EMBED_SRC[name]!)) {
        const url = jsxAttr(node, EMBED_SRC[name]!)!;
        const link: Node = { type: "link", url, children: [{ type: "text", value: fileLabel(url, jsxAttr(node, "title")) }] };
        out.push(flow ? { type: "paragraph", children: [link] } : link);
      } else if (children?.length) {
        // Unknown component or fragment: keep its content.
        out.push(...children);
      } else if (!flow) {
        trimTrailingSpace(out); // `See <Badge />` → `See`
      }
      continue;
    }
    out.push(children ? { ...node, children } : node);
  }
  return out;
}

const stringify = { bullet: "-", emphasis: "_", rule: "-", fences: true } as const;

/** Trusted MDX → Markdown: drops imports/exports/expressions, unwraps JSX. */
export async function mdxToMarkdown(source: string): Promise<string> {
  const processor = unified().use(remarkParse).use(remarkMdx).use(remarkGfm);
  const tree = (await processor.run(processor.parse(source))) as unknown as Node;
  tree.children = stripMdx(tree.children ?? []);
  return unified()
    .use(remarkGfm)
    .use(remarkStringify, stringify)
    .stringify(tree as never);
}

type HastElement = { tagName: string; properties?: Record<string, unknown>; children?: unknown[] };

/** `<embed>` / `<iframe>` / `<object>` → a link to the embedded file (e.g. a PDF). */
function embedHandler(_state: unknown, node: HastElement) {
  const attr = EMBED_SRC[node.tagName] ?? "src";
  const url = node.properties?.[attr];
  if (typeof url !== "string" || !url) return undefined;
  const title = typeof node.properties?.title === "string" ? node.properties.title : undefined;
  return { type: "link", url, children: [{ type: "text", value: fileLabel(url, title) }] };
}

/** HTML → Markdown (GFM tables, fenced code; embedded files become links). */
export async function htmlToMarkdown(html: string): Promise<string> {
  const file = await unified()
    .use(rehypeParse, { fragment: true })
    .use(rehypeRemark, { handlers: { embed: embedHandler, iframe: embedHandler, object: embedHandler } as never })
    .use(remarkGfm)
    .use(remarkStringify, stringify)
    .process(html);
  return String(file);
}

function hasH1(markdown: string): boolean {
  const tree = unified().use(remarkParse).parse(markdown) as unknown as Node;
  const walk = (n: Node): boolean =>
    (n.type === "heading" && n.depth === 1) || (n.children ?? []).some(walk);
  return walk(tree);
}

const bodyCache = new Map<string, Promise<string>>();

/** The chapter's source as Markdown (cached per file + mtime). */
export function chapterBodyToMarkdown(entry: Pick<ChapterEntry, "file" | "mtimeMs" | "format" | "body">): Promise<string> {
  const key = `${entry.file}\0${entry.mtimeMs}`;
  let p = bodyCache.get(key);
  if (!p) {
    p =
      entry.format === "mdx"
        ? // Invalid MDX (e.g. an HTML comment) can't be cleaned: serve the source rather than fail.
          mdxToMarkdown(entry.body).catch(() => entry.body)
        : entry.format === "html"
          ? htmlToMarkdown(entry.body)
          : Promise.resolve(entry.body);
    bodyCache.set(key, p);
    p.catch(() => bodyCache.delete(key));
    if (bodyCache.size > 500) bodyCache.delete(bodyCache.keys().next().value!);
  }
  return p;
}

// ---------------------------------------------------------------- documents

function escapeText(s: string) {
  return s.replace(/([\\[\]*_`])/g, "\\$1");
}

function link(text: string, url: string) {
  return `[${escapeText(text)}](${url})`;
}

function chapterName(ch: ChapterMeta) {
  return ch.label ? `${ch.label}: ${ch.title}` : ch.title;
}

/** One chapter as a standalone Markdown document with prev / contents / next links. */
export async function chapterToMarkdown(hit: ChapterLookup, ctx: AgentUrlContext): Promise<string> {
  const { book, chapter, prev, next } = hit;
  const body = (await chapterBodyToMarkdown(chapter)).trim();
  const parts: string[] = [];
  if (!hasH1(body)) parts.push(`# ${chapter.title}`);
  if (body) parts.push(body);

  const nav = [
    prev && `- Previous: ${link(chapterName(prev), markdownPageUrl(ctx, book.id, prev.id))}`,
    `- Contents: ${link(book.title, markdownPageUrl(ctx, book.id))}`,
    next && `- Next: ${link(chapterName(next), markdownPageUrl(ctx, book.id, next.id))}`,
  ].filter(Boolean);
  parts.push(`---\n\n${nav.join("\n")}`);
  return parts.join("\n\n") + "\n";
}

function chapterList(book: BookMeta, ctx: AgentUrlContext): string {
  const lines: string[] = [];
  let part: string | undefined;
  for (const ch of book.chapters) {
    if (ch.part && ch.part !== part) {
      part = ch.part;
      lines.push(`${lines.length ? "\n" : ""}### ${ch.part}\n`);
    }
    const desc = ch.description ? `: ${ch.description}` : "";
    lines.push(`- ${link(chapterName(ch), markdownPageUrl(ctx, book.id, ch.id))}${desc}`);
  }
  return lines.join("\n");
}

/** A book's front matter and table of contents, linking every chapter's `.md`. */
export function bookToMarkdown(book: BookMeta | BookEntry, ctx: AgentUrlContext): string {
  const parts = [`# ${book.title}`];
  if (book.subtitle) parts.push(`_${escapeText(book.subtitle)}_`);
  if (book.authors.length) parts.push(`By ${book.authors.join(", ")}`);
  if (book.description) parts.push(book.description);
  parts.push(`## Contents\n\n${chapterList(book, ctx)}`);
  parts.push(`---\n\n- All books: ${link("Shelf", markdownPageUrl(ctx))}`);
  return parts.join("\n\n") + "\n";
}

/** Every book on the shelf, linking each book's `.md`. */
export function shelfToMarkdown(books: Array<BookMeta | BookEntry>, ctx: AgentUrlContext): string {
  const parts = ["# Books"];
  for (const book of books) {
    const head = `## ${link(book.title, markdownPageUrl(ctx, book.id))}`;
    const meta = [book.subtitle && `_${escapeText(book.subtitle)}_`, book.authors.length && `By ${book.authors.join(", ")}`, book.description]
      .filter(Boolean)
      .join("\n\n");
    parts.push(meta ? `${head}\n\n${meta}` : head);
  }
  if (!books.length) parts.push("_No books yet._");
  return parts.join("\n\n") + "\n";
}

/** An llms.txt index (https://llmstxt.org) of every chapter's `.md`. */
export function llmsTxt(books: Array<BookMeta | BookEntry>, ctx: AgentUrlContext, opts: LlmsTxtOptions = {}): string {
  const title = opts.title ?? (books.length === 1 ? books[0]!.title : "Books");
  const description =
    opts.description ??
    (books.length === 1 && books[0]!.description
      ? books[0]!.description
      : "Every chapter is available as Markdown; follow the links below for the full text.");
  const parts = [`# ${title}`, `> ${description.replace(/\s*\n\s*/g, " ")}`];
  for (const book of books) {
    const lines = [`- ${link("Table of contents", markdownPageUrl(ctx, book.id))}`];
    for (const ch of book.chapters) {
      const desc = ch.description ? `: ${ch.description}` : "";
      lines.push(`- ${link(chapterName(ch), markdownPageUrl(ctx, book.id, ch.id))}${desc}`);
    }
    parts.push(`## ${book.title}\n\n${lines.join("\n")}`);
  }
  return parts.join("\n\n") + "\n";
}
