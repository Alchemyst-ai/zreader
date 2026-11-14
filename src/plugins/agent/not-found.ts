import type { AgentPlugin } from "./types";
import type { NotFoundInfo } from "./types";

export interface NotFoundOptions {
  /** H1. Default "Not found". */
  title?: string;
  maxBooks?: number;
  maxChapters?: number;
  /** Replace the body entirely. */
  render?: (info: NotFoundInfo) => string | Promise<string>;
}

/**
 * A 404 document that lists the valid book and chapter ids, so an agent that
 * guessed an id can correct itself. Only lists this shelf's books.
 */
export function notFound(opts: NotFoundOptions = {}): AgentPlugin {
  return {
    name: "notFound",

    async document(doc, ctx) {
      if (doc.kind !== "notFound" || !doc.notFound) return doc;
      const { notFoundToMarkdown } = await import("zreader/agent");
      const body = opts.render
        ? await opts.render(doc.notFound)
        : notFoundToMarkdown(doc.notFound, ctx.url, {
            title: opts.title,
            maxBooks: opts.maxBooks,
            maxChapters: opts.maxChapters,
          });
      return { ...doc, body };
    },
  };
}
