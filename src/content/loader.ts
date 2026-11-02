import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import matter from "gray-matter";
import { glob as globFiles } from "tinyglobby";
import type { ResolvedReaderConfig } from "../config/index";
import type { BookMeta, ChapterMeta } from "../core/types";
import { compileMdx, renderHtml, renderMarkdown, type ChapterFormat, type HtmlResult, type MdxCompiled } from "./pipeline";

export interface ChapterEntry extends ChapterMeta {
  bookId: string;
  file: string;
  format: ChapterFormat;
  /** Validated frontmatter. */
  data: Record<string, unknown>;
  body: string;
  draft: boolean;
  mtimeMs: number;
}

export interface BookEntry extends BookMeta {
  /** Validated book.json. */
  data: Record<string, unknown>;
  dir: string;
  chapterEntries: ChapterEntry[];
}

export class ContentError extends Error {
  constructor(
    message: string,
    public readonly file?: string,
  ) {
    super(file ? `${message}\n  at ${file}` : message);
    this.name = "ContentError";
  }
}

const FORMATS: Record<string, ChapterFormat> = { ".md": "md", ".markdown": "md", ".mdx": "mdx", ".html": "html", ".htm": "html" };
const ORDER_PREFIX = /^(\d+)[-_. ]+/;

function titleCase(slug: string) {
  return slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function validate(schema: { safeParse(v: unknown): { success: boolean; data?: unknown; error?: unknown } }, value: unknown, file: string, what: string) {
  const r = schema.safeParse(value);
  if (!r.success) {
    const issues = (r.error as { issues?: { path: PropertyKey[]; message: string }[] })?.issues ?? [];
    const msg = issues.map((i) => `  - ${i.path.map(String).join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new ContentError(`Invalid ${what}:\n${msg || String(r.error)}`, file);
  }
  return r.data as Record<string, unknown>;
}

/** Read every book + chapter frontmatter (bodies are compiled lazily). */
export async function loadBooks(config: ResolvedReaderConfig): Promise<BookEntry[]> {
  const { loader, schemas, includeDrafts } = config.content;
  const base = resolve(config.root, loader.base);
  if (!existsSync(base)) return [];
  const files = await globFiles(loader.pattern, { cwd: base, ignore: loader.ignore, onlyFiles: true });
  files.sort();

  const byBook = new Map<string, ChapterEntry[]>();
  for (const rel of files) {
    const parts = rel.split(/[\\/]/);
    if (parts.length < 2) continue; // files must live inside a book folder
    const format = FORMATS[extname(rel).toLowerCase()];
    if (!format) continue;
    const bookId = parts[0]!;
    const file = join(base, rel);
    const [raw, st] = await Promise.all([readFile(file, "utf8"), stat(file)]);
    const fm = matter(raw);
    const data = validate(schemas.chapter, fm.data, file, "chapter frontmatter");
    const stem = basename(rel, extname(rel));
    const prefix = ORDER_PREFIX.exec(stem);
    const id = stem.replace(ORDER_PREFIX, "");
    const draft = data.draft === true;
    if (draft && !includeDrafts) continue;
    const list = byBook.get(bookId) ?? [];
    if (list.some((c) => c.id === id)) throw new ContentError(`Duplicate chapter id "${id}" in book "${bookId}"`, file);
    list.push({
      id,
      bookId,
      title: String(data.title ?? titleCase(id)),
      order: typeof data.order === "number" ? data.order : prefix ? Number(prefix[1]) : Number.MAX_SAFE_INTEGER,
      description: typeof data.description === "string" ? data.description : undefined,
      part: typeof data.part === "string" ? data.part : undefined,
      label: typeof data.label === "string" ? data.label : undefined,
      number: data.number != null ? String(data.number) : undefined,
      file,
      format,
      data,
      body: fm.content,
      draft,
      mtimeMs: st.mtimeMs,
    });
    byBook.set(bookId, list);
  }

  const books: BookEntry[] = [];
  for (const [bookId, chapters] of byBook) {
    const dir = join(base, bookId);
    const metaFile = join(dir, "book.json");
    let rawMeta: unknown = { title: titleCase(bookId) };
    if (existsSync(metaFile)) {
      try {
        rawMeta = JSON.parse(await readFile(metaFile, "utf8"));
      } catch (e) {
        throw new ContentError(`book.json is not valid JSON: ${(e as Error).message}`, metaFile);
      }
    }
    const data = validate(schemas.book, rawMeta, metaFile, "book.json");
    const explicit = Array.isArray(data.chapters) ? (data.chapters as string[]) : null;
    chapters.sort((a, b) => {
      if (explicit) {
        const ia = explicit.indexOf(a.id);
        const ib = explicit.indexOf(b.id);
        if (ia !== ib) return (ia < 0 ? Infinity : ia) - (ib < 0 ? Infinity : ib);
      }
      return a.order - b.order || a.file.localeCompare(b.file);
    });
    books.push({
      id: bookId,
      title: String(data.title ?? titleCase(bookId)),
      authors: Array.isArray(data.authors) ? (data.authors as string[]) : [],
      description: typeof data.description === "string" ? data.description : undefined,
      cover: typeof data.cover === "string" ? data.cover : undefined,
      subtitle: typeof data.subtitle === "string" ? data.subtitle : undefined,
      chapters: chapters.map(({ id, title, order, description, part, label, number }) => ({
        id,
        title,
        order,
        ...(description ? { description } : {}),
        ...(part ? { part } : {}),
        ...(label ? { label } : {}),
        ...(number ? { number } : {}),
      })),
      data,
      dir,
      chapterEntries: chapters,
    });
  }
  books.sort((a, b) => a.title.localeCompare(b.title));
  return books;
}

// ------------------------------------------------------------- compile cache

const PIPELINE_VERSION = "2"; // bump when compiled output changes (e.g. block-id scheme)
const memory = new Map<string, Promise<HtmlResult | MdxCompiled>>();

function pluginSignature(list: unknown[]): string {
  return list
    .map((p) => (Array.isArray(p) ? `${(p[0] as { name?: string })?.name}:${JSON.stringify(p.slice(1))}` : (p as { name?: string })?.name))
    .join(",");
}

function cacheKey(entry: ChapterEntry, config: ResolvedReaderConfig) {
  const c = config.content;
  return createHash("sha256")
    .update(
      [
        PIPELINE_VERSION,
        entry.file,
        entry.mtimeMs,
        entry.body.length,
        createHash("sha1").update(entry.body).digest("hex"),
        JSON.stringify(c.sanitize),
        pluginSignature(c.remarkPlugins),
        pluginSignature(c.rehypePlugins),
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 32);
}

export async function compileChapter(entry: ChapterEntry, config: ResolvedReaderConfig): Promise<HtmlResult | MdxCompiled> {
  const key = cacheKey(entry, config);
  const hit = memory.get(key);
  if (hit) return hit;
  const p = (async () => {
    const dir = resolve(config.root, config.content.cacheDir);
    const diskFile = join(dir, `${key}.json`);
    try {
      return JSON.parse(await readFile(diskFile, "utf8")) as HtmlResult | MdxCompiled;
    } catch {
      /* miss */
    }
    const opts = {
      sanitize: config.content.sanitize,
      remarkPlugins: config.content.remarkPlugins as never,
      rehypePlugins: config.content.rehypePlugins as never,
    };
    let out: HtmlResult | MdxCompiled;
    try {
      out =
        entry.format === "mdx"
          ? await compileMdx(entry.body, opts)
          : entry.format === "md"
            ? await renderMarkdown(entry.body, opts)
            : await renderHtml(entry.body, opts);
    } catch (e) {
      throw new ContentError(`Failed to compile chapter: ${(e as Error).message}`, entry.file);
    }
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(diskFile, JSON.stringify(out));
    } catch {
      /* cache is best-effort (read-only FS on some hosts) */
    }
    return out;
  })();
  memory.set(key, p);
  p.catch(() => memory.delete(key));
  return p;
}

export function relativeToRoot(config: ResolvedReaderConfig, file: string) {
  return relative(config.root, file).split(sep).join("/");
}
