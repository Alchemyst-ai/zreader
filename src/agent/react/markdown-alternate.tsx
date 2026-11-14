import { useReaderChapter, type ReaderChapterValue } from "zreader/react";

function useOptionalReaderChapter(): ReaderChapterValue | null {
  // useReaderChapter() reads a context and throws outside <Reader>; the hook
  // itself is always called, so this keeps hook order stable.
  try {
    return useReaderChapter();
  } catch {
    return null;
  }
}

export { useOptionalReaderChapter };

/** `.md` twin of a reader href (relative or absolute): drops the hash/query, appends `.md`. */
export function markdownHref(href: string): string {
  const path = href.split("#")[0]!.split("?")[0]!.replace(/\/+$/, "");
  if (!path) return "/index.md";
  return path.endsWith(".md") ? path : `${path}.md`;
}

/**
 * `<link rel="alternate" type="text/markdown">` for the current chapter, so
 * agents and crawlers can find its Markdown twin. React 19 hoists it into
 * <head>. Renders nothing outside <Reader>.
 */
export function MarkdownAlternate() {
  const ctx = useOptionalReaderChapter();
  if (!ctx) return null;
  return <link rel="alternate" type="text/markdown" href={markdownHref(ctx.href(ctx.chapter.id))} title={ctx.chapter.title} />;
}
