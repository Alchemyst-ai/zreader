import type { BookEntry } from "zreader/content";
import type { ResolvedShelf } from "../../config/index";
import type { AgentPlugin, AgentPluginContext, AgentPluginRoute } from "./types";

export interface LlmsTxtPluginOptions {
  /** Also serve `{basePath}/llms-full.txt`. Default false. */
  full?: boolean;
  /** Also serve `/llms.txt` (and `/llms-full.txt` with `full`) at the site root. One shelf only. */
  root?: boolean;
  /** H1. Defaults to the shelf title (or the book title for a one-book shelf). */
  title?: string;
  /** Summary line. Defaults to the shelf description. */
  description?: string;
}

interface Memo {
  key: string;
  promise: Promise<string>;
}

/** `llms-full.txt` is memoised per shelf, keyed on every chapter's file + mtime. */
function contentKey(books: BookEntry[]): string {
  return books.flatMap((b) => b.chapterEntries.map((c) => `${c.file}:${c.mtimeMs}`)).join("|");
}

function documentTitle(opts: LlmsTxtPluginOptions, ctx: AgentPluginContext, books: BookEntry[]): string {
  return opts.title ?? (books.length === 1 ? books[0]!.title : ctx.shelf.title);
}

/**
 * `{basePath}/llms.txt` — an llms.txt index (https://llmstxt.org) of this shelf's
 * books only — and, with `full`, `{basePath}/llms-full.txt` with every chapter
 * concatenated.
 */
export function llmsTxt(opts: LlmsTxtPluginOptions = {}): AgentPlugin {
  const memos = new WeakMap<ResolvedShelf, Memo>();

  async function index(ctx: AgentPluginContext) {
    const { llmsTxt: build } = await import("zreader/agent");
    const books = await ctx.api.getBooks();
    return build(books, ctx.url, {
      title: documentTitle(opts, ctx, books),
      description: opts.description ?? ctx.shelf.description,
    });
  }

  async function full(ctx: AgentPluginContext, head: boolean): Promise<string> {
    // HEAD returns headers without building the document (§6.5).
    if (head) return "";
    const books = await ctx.api.getBooks();
    const key = contentKey(books);
    let memo = memos.get(ctx.shelf);
    if (!memo || memo.key !== key) {
      const promise = (async () => {
        const { fullTextToMarkdown } = await import("zreader/agent");
        return fullTextToMarkdown(books, ctx.url, {
          // The whole shelf, so the shelf title — not the one-book shortcut.
          title: `${opts.title ?? ctx.shelf.title} — full text`,
          description: opts.description ?? ctx.shelf.description,
        });
      })();
      memo = { key, promise };
      memos.set(ctx.shelf, memo);
      promise.catch(() => {
        if (memos.get(ctx.shelf) === memo) memos.delete(ctx.shelf);
      });
    }
    return memo.promise;
  }

  const routes: AgentPluginRoute[] = [
    {
      path: "/llms.txt",
      handle: (_request: Request, ctx: AgentPluginContext) => index(ctx).then((body) => ctx.respond(body, { type: "text/plain" })),
    },
  ];
  if (opts.full) {
    routes.push({
      path: "/llms-full.txt",
      handle: (request: Request, ctx: AgentPluginContext) =>
        full(ctx, request.method === "HEAD").then((body) => ctx.respond(body, { type: "text/markdown" })),
    });
  }

  return {
    name: "llmsTxt",
    routes,
    // A shelf at "/" already serves /llms.txt from its relative route.
    rootRoutes: opts.root ? routes : undefined,
  };
}
