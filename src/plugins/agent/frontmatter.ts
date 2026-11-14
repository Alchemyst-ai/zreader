import type { ChapterEntry } from "zreader/content";
import type { LastUpdatedInput } from "../../agent/markdown";
import type { AgentDocument, AgentPlugin } from "./types";

export interface FrontmatterOptions {
  /**
   * Document title. Default: chapter → "Chapter — Book"; book → book title;
   * shelf → shelf title.
   */
  title?: (doc: AgentDocument) => string;
  /** Override how `last_updated` is found (§5.4). */
  lastUpdated?: (entry: ChapterEntry) => LastUpdatedInput;
  /** Extra fields, appended after the standard ones in insertion order. */
  extra?: (doc: AgentDocument) => Record<string, string | undefined> | undefined;
}

function isDev() {
  return typeof process !== "undefined" && process.env?.NODE_ENV === "development";
}

function defaultTitle(doc: AgentDocument): string {
  switch (doc.kind) {
    case "chapter":
      return `${doc.chapter!.chapter.title} — ${doc.chapter!.book.title}`;
    case "book":
      return doc.book!.title;
    default:
      return doc.meta.title;
  }
}

function defaultExtras(doc: AgentDocument): Record<string, string | undefined> {
  if (doc.kind !== "chapter") return {};
  const { chapter, book } = doc.chapter!;
  return { book: book.title, ...(chapter.label ? { label: chapter.label } : {}) };
}

/**
 * YAML frontmatter (`title`, `description`, `canonical`, `last_updated`, …) on
 * every `.md` twin and 404. Not applied to `llms.txt`, `llms-full.txt` or MCP
 * responses.
 */
export function frontmatter(opts: FrontmatterOptions = {}): AgentPlugin {
  return {
    name: "frontmatter",

    async document(doc, ctx) {
      const { isValidFrontmatterKey, newestBookLastUpdated, newestLastUpdated, renderFrontmatter, resolveLastUpdated } =
        await import("zreader/agent");

      // The core computes dates without the plugin's override, so redo them here.
      let lastUpdated = doc.meta.lastUpdated;
      if (opts.lastUpdated) {
        lastUpdated =
          doc.kind === "chapter"
            ? resolveLastUpdated(doc.chapter!.chapter, opts.lastUpdated)
            : doc.kind === "book"
              ? newestLastUpdated(doc.book!.chapterEntries, opts.lastUpdated)
              : doc.kind === "shelf"
                ? newestBookLastUpdated(await ctx.api.getBooks(), opts.lastUpdated)
                : undefined;
      }

      const fields: Record<string, string | undefined> = {
        title: opts.title?.(doc) ?? defaultTitle(doc),
        description: doc.meta.description,
        // 404 documents get a title and description, never a canonical.
        ...(doc.kind === "notFound" ? {} : { canonical: doc.meta.canonical }),
        last_updated: lastUpdated,
      };

      for (const [key, value] of Object.entries(opts.extra?.(doc) ?? defaultExtras(doc))) {
        if (!isValidFrontmatterKey(key)) {
          if (isDev()) console.warn(`[zreader] frontmatter: ignoring extra key "${key}" (not a valid YAML field name)`);
          continue;
        }
        fields[key] = value;
      }

      const block = renderFrontmatter(fields);
      return block ? { ...doc, preamble: [...doc.preamble, block] } : doc;
    },
  };
}
