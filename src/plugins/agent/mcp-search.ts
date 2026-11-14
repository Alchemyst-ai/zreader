/**
 * The default `search` tool for `mcp()`: an in-memory BM25 index built lazily
 * per shelf from `chapterBodyToMarkdown()` output.
 *
 * Good enough for a shelf of hundreds of chapters. Anything larger passes its
 * own `search` to `mcp()`.
 */
import type { BookEntry } from "zreader/content";
import type { ResolvedShelf } from "../../config/index";
import type { AgentPluginContext } from "./types";
import type { SearchHit } from "./mcp";

const K1 = 1.2;
const B = 0.75;
/** Title matches weigh more than body matches. */
const TITLE_BOOST = 3;
const SNIPPET_RADIUS = 100;

interface Entry {
  book: string;
  chapter: string;
  title: string;
  url: string;
  text: string;
  bodyTerms: Map<string, number>;
  titleTerms: Map<string, number>;
  length: number;
}

interface Memo {
  key: string;
  promise: Promise<Entry[]>;
}

const memos = new WeakMap<ResolvedShelf, Memo>();

/** Lower-case, diacritic-folded terms. */
function terms(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

function count(terms: string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of terms) out.set(t, (out.get(t) ?? 0) + 1);
  return out;
}

async function buildIndex(ctx: AgentPluginContext, books: BookEntry[]): Promise<Entry[]> {
  const { chapterBodyToMarkdown, pageUrl } = await import("zreader/agent");
  const out: Entry[] = [];
  for (const book of books) {
    for (const chapter of book.chapterEntries) {
      const body = (await chapterBodyToMarkdown(chapter)).trim();
      const bodyTerms = count(terms(body));
      out.push({
        book: book.id,
        chapter: chapter.id,
        title: chapter.title,
        url: pageUrl(ctx.url, book.id, chapter.id),
        text: body,
        bodyTerms,
        titleTerms: count(terms(chapter.title)),
        length: [...bodyTerms.values()].reduce((a, b) => a + b, 0),
      });
    }
  }
  return out;
}

/** Memoised on every chapter's `file` + `mtimeMs`, like `chapterBodyToMarkdown`. */
async function index(ctx: AgentPluginContext): Promise<Entry[]> {
  const books = await ctx.api.getBooks();
  const key = books.flatMap((b) => b.chapterEntries.map((c) => `${c.file}:${c.mtimeMs}`)).join("|");
  let memo = memos.get(ctx.shelf);
  if (!memo || memo.key !== key) {
    const promise = buildIndex(ctx, books);
    memo = { key, promise };
    memos.set(ctx.shelf, memo);
    promise.catch(() => {
      if (memos.get(ctx.shelf) === memo) memos.delete(ctx.shelf);
    });
  }
  return memo.promise;
}

/** ~200 characters around the first match of any query term. */
function snippet(text: string, query: string[]): string {
  const haystack = text.toLowerCase();
  let at = -1;
  for (const q of query) {
    const i = haystack.indexOf(q);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return text.slice(0, SNIPPET_RADIUS * 2).replace(/\s+/g, " ").trim();
  const start = Math.max(0, at - SNIPPET_RADIUS);
  const end = Math.min(text.length, at + SNIPPET_RADIUS);
  const out = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${out}${end < text.length ? "…" : ""}`;
}

/** BM25 over chapters, with a title bonus. */
export async function searchChapters(
  ctx: AgentPluginContext,
  query: string,
  opts: { book?: string; limit: number },
): Promise<SearchHit[]> {
  const entries = await index(ctx);
  const q = terms(query);
  if (!q.length) return [];

  const pool = opts.book ? entries.filter((e) => e.book === opts.book) : entries;
  if (!pool.length) return [];

  const avgLength = pool.reduce((a, e) => a + e.length, 0) / pool.length || 1;
  const df = new Map<string, number>();
  for (const term of new Set(q)) {
    df.set(
      term,
      pool.filter((e) => e.bodyTerms.has(term) || e.titleTerms.has(term)).length,
    );
  }

  const hits: SearchHit[] = [];
  for (const entry of pool) {
    let score = 0;
    for (const term of new Set(q)) {
      const n = df.get(term) ?? 0;
      if (!n) continue;
      const idf = Math.log(1 + (pool.length - n + 0.5) / (n + 0.5));
      const f = entry.bodyTerms.get(term) ?? 0;
      const tf = (f * (K1 + 1)) / (f + K1 * (1 - B + (B * entry.length) / avgLength));
      const title = entry.titleTerms.get(term) ?? 0;
      score += idf * (tf + TITLE_BOOST * title);
    }
    if (score > 0) {
      hits.push({
        book: entry.book,
        chapter: entry.chapter,
        title: entry.title,
        url: entry.url,
        snippet: snippet(entry.text, q),
        score: Number(score.toFixed(4)),
      });
    }
  }

  hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return hits.slice(0, opts.limit);
}
