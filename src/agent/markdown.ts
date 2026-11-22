/**
 * Chapter / book / shelf → plain Markdown for agents (LLMs, crawlers, CLIs).
 * Server-only: reads the content layer's raw chapter sources.
 */
import rehypeParse from "rehype-parse";
import rehypeRemark from "rehype-remark";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import type { BookEntry, ChapterEntry, ChapterLookup } from "zreader/content";
import { fenceAttr, isRunnableMeta, outputPairs, sandboxLanguage, type BookMeta, type ChapterMeta } from "zreader";
import type { NotFoundInfo } from "../plugins/agent/types";

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

/** Title and summary a shelf document can be headed with. */
export interface ShelfOptions {
  title?: string;
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

/** A fence line: blockquote/list prefix, at most 3 spaces of indent, the fence, its info string. */
const FENCE_LINE = /^((?:[ \t]*>)*(?:[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+)? {0,3})(`{3,}|~{3,})(.*)$/;

/**
 * RunnableCode fences as plain fences, for `.md` twins: ```` ```py run id=k3 ````
 * becomes ```` ```python ```` and its ```` ```output for=k3 ```` becomes
 * ```` ```text ````. Every other line is left exactly as written.
 */
export function plainRunnableFences(markdown: string): string {
  if (!/(?:`{3,}|~{3,})[ \t]*\w+[ \t]+(?:[^\n]*[ \t])?run(?:[ \t]|$)/m.test(markdown)) return markdown;
  const lines = markdown.split("\n");
  let open: { char: string; len: number } | null = null;
  /** The id of the RunnableCode that just closed (`""` without one), while only blank lines follow it. */
  let afterRunnable: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const cr = lines[i]!.endsWith("\r") ? "\r" : "";
    const line = cr ? lines[i]!.slice(0, -1) : lines[i]!;
    let m = FENCE_LINE.exec(line);
    // A backtick fence's info string can't contain backticks (```` ```js``` ```` is inline code).
    if (m && m[2]![0] === "`" && m[3]!.includes("`")) m = null;
    if (open) {
      // A closing fence: same character, at least as long, no info string.
      if (m && m[2]![0] === open.char && m[2]!.length >= open.len && !m[3]!.trim()) open = null;
      continue;
    }
    if (!m) {
      if (line.replace(/^(?:[ \t]*>)*/, "").trim()) afterRunnable = null;
      continue;
    }
    const [, prefix, ticks, rest] = m as unknown as [string, string, string, string];
    open = { char: ticks[0]!, len: ticks.length };
    const [info = "", ...metaWords] = rest.trim().split(/\s+/);
    const meta = metaWords.join(" ");
    const language = sandboxLanguage(info);
    if (language && isRunnableMeta(meta)) {
      lines[i] = `${prefix}${ticks}${language}${cr}`;
      afterRunnable = fenceAttr(meta, "id") ?? "";
      continue;
    }
    // The same pairing as the page: only the Output right after its code.
    if (info === "output" && afterRunnable !== null && outputPairs(afterRunnable || null, meta)) lines[i] = `${prefix}${ticks}text${cr}`;
    afterRunnable = null;
  }
  return lines.join("\n");
}

/** A JSX attribute that is a string, or a plain string literal expression (`code={"…"}`). */
function jsxString(node: Node, name: string): string | undefined {
  const attrs = (node.attributes as JsxAttribute[] | undefined) ?? [];
  const a = attrs.find((x) => x.type === "mdxJsxAttribute" && x.name === name);
  if (typeof a?.value === "string") return a.value;
  const expr = (a?.value as { type?: string; value?: string } | undefined)?.value?.trim();
  if (!expr) return undefined;
  // Re-quote a '…' or `…` literal as "…" so JSON.parse handles its escapes.
  const requote = (inner: string, quote: string) => JSON.parse(`"${inner.replace(new RegExp(`\\\\${quote}`, "g"), quote).replace(/(^|[^\\])"/g, '$1\\"').replace(/\n/g, "\\n")}"`) as string;
  try {
    if (/^"(?:[^"\\]|\\.)*"$/.test(expr)) return JSON.parse(expr) as string;
    if (/^'(?:[^'\\]|\\.)*'$/.test(expr)) return requote(expr.slice(1, -1), "'");
    if (/^`(?:[^`$\\]|\\.)*`$/.test(expr)) return requote(expr.slice(1, -1), "`");
  } catch {
    /* not a plain string */
  }
  return undefined;
}

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
    if (node.type === "code") {
      // RunnableCode and its Output as plain fences.
      const language = sandboxLanguage(node.lang as string);
      const prev = out[out.length - 1] as (Node & { runnableId?: string | null }) | undefined;
      if (language && isRunnableMeta(node.meta as string)) {
        out.push({ ...node, lang: language, meta: null, runnableId: fenceAttr(node.meta as string, "id") ?? null } as Node);
        continue;
      }
      // The same pairing as the page: only the Output right after its code.
      if (node.lang === "output" && prev && "runnableId" in prev && outputPairs(prev.runnableId, node.meta as string)) {
        out.push({ ...node, lang: "text", meta: null });
        continue;
      }
    }
    if (node.type === "mdxJsxFlowElement" && node.name === "RunnableCode") {
      const code = jsxString(node, "code");
      if (code != null) {
        const info = jsxString(node, "language") ?? "";
        out.push({ type: "code", lang: sandboxLanguage(info) ?? info, meta: null, value: code });
        const output = jsxString(node, "output");
        if (output != null) out.push({ type: "code", lang: "text", meta: null, value: output });
      } else {
        // Code from an expression can't be shown without running the MDX.
        out.push({ type: "paragraph", children: [{ type: "text", value: "(Runnable code: see the page.)" }] });
      }
      continue;
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

/**
 * Trusted MDX → Markdown: drops imports/exports/expressions, unwraps JSX.
 * `$…$` and `$$…$$` are parsed as math first, so TeX braces survive.
 */
export async function mdxToMarkdown(source: string): Promise<string> {
  const processor = unified().use(remarkParse).use(remarkMath).use(remarkMdx).use(remarkGfm);
  const tree = (await processor.run(processor.parse(source))) as unknown as Node;
  tree.children = stripMdx(tree.children ?? []);
  return unified()
    .use(remarkGfm)
    .use(remarkMath)
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

function hastText(node: unknown): string {
  const n = node as { type?: string; value?: string; children?: unknown[] };
  if (n.type === "text") return n.value ?? "";
  return (n.children ?? []).map(hastText).join("");
}

function findTex(node: unknown): string | undefined {
  const n = node as HastElement & { type?: string };
  if (n.type === "element" && n.tagName === "annotation" && n.properties?.encoding === "application/x-tex") return hastText(n).trim();
  for (const c of n.children ?? []) {
    const t = findTex(c);
    if (t != null) return t;
  }
  return undefined;
}

/** `<math>` with a TeX annotation → `$tex$` / `$$tex$$`; without one, its text. */
function mathHandler(_state: unknown, node: HastElement) {
  const tex = findTex(node);
  if (tex == null) return { type: "text", value: hastText(node).replace(/\s+/g, " ").trim() };
  return node.properties?.display === "block" ? { type: "math", value: tex } : { type: "inlineMath", value: tex };
}

/** HTML → Markdown (GFM tables, fenced code, math; embedded files become links). */
export async function htmlToMarkdown(html: string): Promise<string> {
  const file = await unified()
    .use(rehypeParse, { fragment: true })
    .use(rehypeRemark, { handlers: { embed: embedHandler, iframe: embedHandler, object: embedHandler, math: mathHandler } as never })
    .use(remarkGfm)
    .use(remarkMath)
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
          : Promise.resolve(plainRunnableFences(entry.body));
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
export function shelfToMarkdown(books: Array<BookMeta | BookEntry>, ctx: AgentUrlContext, opts: ShelfOptions = {}): string {
  const parts = [`# ${opts.title ?? "Books"}`];
  if (opts.description) parts.push(`> ${opts.description.replace(/\s*\n\s*/g, " ")}`);
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

// ---------------------------------------------------------------- frontmatter

const FRONTMATTER_KEY = /^[A-Za-z_][\w-]*$/;

/** True when `key` can appear as a YAML frontmatter field name. */
export function isValidFrontmatterKey(key: string): boolean {
  return FRONTMATTER_KEY.test(key);
}

/**
 * Render a YAML frontmatter block. Field order is the object's insertion order.
 * Every value is a JSON string, which is a valid YAML double-quoted scalar.
 * `undefined` and empty values are omitted; `""` when nothing is left.
 *
 * Named `renderFrontmatter` so it doesn't clash with the `frontmatter()` plugin,
 * or with "frontmatter" as zreader already uses it for chapter source metadata.
 */
export function renderFrontmatter(fields: Record<string, string | undefined>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (!FRONTMATTER_KEY.test(key)) {
      throw new Error(`zreader: "${key}" is not a valid frontmatter key (use letters, digits, '_' or '-')`);
    }
    if (value === undefined || value === "") continue;
    lines.push(`${key}: ${JSON.stringify(value.replace(/\s+/g, " ").trim())}`);
  }
  return lines.length ? `---\n${lines.join("\n")}\n---\n\n` : "";
}

// ---------------------------------------------------------------- dates

const LAST_UPDATED_KEYS = ["updated", "lastUpdated", "last_updated", "date"];

function toIsoDate(value: unknown): string | undefined {
  const ms =
    value instanceof Date
      ? value.getTime()
      : typeof value === "number"
        ? value
        : typeof value === "string"
          ? Date.parse(value)
          : NaN;
  if (!Number.isFinite(ms)) return undefined;
  try {
    return new Date(ms).toISOString().slice(0, 10);
  } catch {
    return undefined;
  }
}

/** Anything a `last_updated` source may return. */
export type LastUpdatedInput = string | Date | number | undefined;

/**
 * A chapter's `last_updated` (§5.4): the `lastUpdated` override, then the
 * chapter's frontmatter (`updated`, `lastUpdated`, `last_updated`, `date`), then
 * `mtimeMs`. Invalid dates are skipped. `YYYY-MM-DD`, in UTC.
 *
 * On CI and most hosts `mtimeMs` is the checkout time, because `git clone` does
 * not preserve modification times. For dates that survive a deploy, set
 * `updated:` in chapter frontmatter or pass a `lastUpdated` override.
 */
export function resolveLastUpdated(
  entry: Pick<ChapterEntry, "data" | "mtimeMs">,
  override?: (entry: ChapterEntry) => LastUpdatedInput,
): string | undefined {
  const sources: unknown[] = [];
  if (override) sources.push(override(entry as ChapterEntry));
  for (const key of LAST_UPDATED_KEYS) sources.push(entry.data?.[key]);
  sources.push(entry.mtimeMs);
  for (const s of sources) {
    const iso = toIsoDate(s);
    if (iso) return iso;
  }
  return undefined;
}

/** The newest `last_updated` across chapters. */
export function newestLastUpdated(
  entries: ChapterEntry[],
  override?: (entry: ChapterEntry) => LastUpdatedInput,
): string | undefined {
  let best: string | undefined;
  for (const entry of entries) {
    const iso = resolveLastUpdated(entry, override);
    if (iso && (!best || iso > best)) best = iso;
  }
  return best;
}

/** The newest `last_updated` across books (the newest of their chapters). */
export function newestBookLastUpdated(
  books: BookEntry[],
  override?: (entry: ChapterEntry) => LastUpdatedInput,
): string | undefined {
  let best: string | undefined;
  for (const book of books) {
    const iso = newestLastUpdated(book.chapterEntries, override);
    if (iso && (!best || iso > best)) best = iso;
  }
  return best;
}

// ---------------------------------------------------------------- full text

/** Shift every heading down by `by` levels, on the mdast. Depth is clamped at 6. */
export async function demoteHeadings(markdown: string, by: number): Promise<string> {
  if (!by) return markdown;
  const processor = unified().use(remarkParse);
  const tree = processor.parse(markdown) as unknown as Node;
  const walk = (n: Node) => {
    if (n.type === "heading") n.depth = Math.min(6, Number(n.depth) + by);
    for (const child of n.children ?? []) walk(child);
  };
  walk(tree);
  return unified()
    .use(remarkGfm)
    .use(remarkStringify, stringify)
    .stringify(tree as never);
}

/** A chapter body without the 500-entry cache, so a big shelf can't thrash it. */
async function uncachedBody(entry: ChapterEntry): Promise<string> {
  return entry.format === "mdx"
    ? mdxToMarkdown(entry.body).catch(() => entry.body)
    : entry.format === "html"
      ? htmlToMarkdown(entry.body)
      : entry.body;
}

/**
 * Every chapter of every book, concatenated (§6.3): H1 for the document, H2 per
 * book, H3 per chapter, so chapter content starts at H4.
 */
export async function fullTextToMarkdown(
  books: BookEntry[],
  ctx: AgentUrlContext,
  opts: ShelfOptions = {},
): Promise<string> {
  const title = opts.title ?? (books.length === 1 ? `${books[0]!.title} — full text` : "Books — full text");
  const description =
    opts.description ?? "Every book and chapter in this shelf, concatenated for agents.";
  const parts = [`# ${title}`, `> ${description.replace(/\s*\n\s*/g, " ")}`];
  for (const book of books) {
    const bookParts = [`## ${book.title}`, `Source: ${pageUrl(ctx, book.id)}`];
    if (book.description) bookParts.push(book.description);
    for (const chapter of book.chapterEntries) {
      const body = (await uncachedBody(chapter)).trim();
      if (!body) continue;
      const section: string[] = [];
      // A body with its own H1 keeps it (demoted to H3); otherwise the title stands in.
      if (!hasH1(body)) section.push(`### ${chapter.title}`);
      section.push(await demoteHeadings(body, 2));
      bookParts.push(section.join("\n\n"));
    }
    parts.push(bookParts.join("\n\n"));
  }
  return parts.join("\n\n") + "\n";
}

// ---------------------------------------------------------------- 404

/** Options shared by `notFound()` and `notFoundToMarkdown()`. */
export interface NotFoundMarkdownOptions {
  /** H1. Default "Not found". */
  title?: string;
  maxBooks?: number;
  maxChapters?: number;
  /** Replace the body entirely. */
  render?: (info: NotFoundInfo) => string;
}

function count(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Where a truncated list points: this shelf's `llms.txt`, else its `.md`. */
function overflowUrl(info: NotFoundInfo, ctx: AgentUrlContext): string {
  const hasLlms = info.shelf.plugins.some((p) => p.name === "llmsTxt");
  return hasLlms ? `${ctx.origin}${base(ctx.basePath)}/llms.txt` : markdownPageUrl(ctx);
}

/**
 * A 404 document that lists the valid book and chapter ids of one shelf (§7.1).
 */
export function notFoundToMarkdown(
  info: NotFoundInfo,
  ctx: AgentUrlContext,
  opts: NotFoundMarkdownOptions = {},
): string {
  if (opts.render) return opts.render(info);
  const maxBooks = opts.maxBooks ?? 50;
  const maxChapters = opts.maxChapters ?? 100;
  const parts = [`# ${opts.title ?? "Not found"}`];

  if (info.what === "chapter" && info.book) {
    parts.push(
      `No chapter \`${info.chapterId}\` in [${escapeText(info.book.title)}](${markdownPageUrl(ctx, info.bookId)}).`,
    );
  } else {
    parts.push(`No book \`${info.bookId}\` in the [shelf](${info.shelfUrl}).`);
  }

  if (info.book) {
    const chapters = info.book.chapters;
    const lines = chapters
      .slice(0, maxChapters)
      .map((ch) => `- ${link(chapterName(ch), markdownPageUrl(ctx, info.bookId, ch.id))}`);
    if (chapters.length > maxChapters) {
      lines.push(`- …and ${chapters.length - maxChapters} more; see the [index](${overflowUrl(info, ctx)})`);
    }
    parts.push(`## Chapters in ${info.book.title}\n\n${lines.join("\n")}`);
  }

  const books = info.books;
  const bookLines = books
    .slice(0, maxBooks)
    .map((b) => `- ${link(b.title, markdownPageUrl(ctx, b.id))} — ${count(b.chapters.length, "chapter", "chapters")}`);
  if (books.length > maxBooks) {
    bookLines.push(`- …and ${books.length - maxBooks} more; see the [index](${overflowUrl(info, ctx)})`);
  }
  parts.push(`## All books\n\n${bookLines.length ? bookLines.join("\n") : "_No books yet._"}`);
  parts.push(`See the [shelf](${info.shelfUrl}).`);
  return parts.join("\n\n") + "\n";
}
