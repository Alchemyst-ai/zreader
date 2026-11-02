import type { ChapterMeta } from "zreader";

export interface PartGroup {
  part: string | null;
  items: Array<{ chapter: ChapterMeta; index: number }>;
}

/** Consecutive chapters sharing a `part` are grouped; books without parts yield one group. */
export function groupByPart(chapters: ChapterMeta[]): PartGroup[] {
  const groups: PartGroup[] = [];
  chapters.forEach((chapter, index) => {
    const part = chapter.part ?? null;
    const last = groups[groups.length - 1];
    if (last && last.part === part) last.items.push({ chapter, index });
    else groups.push({ part, items: [{ chapter, index }] });
  });
  return groups;
}

/** Short list marker: frontmatter `number`, else the 1-based position. */
export function chapterMarker(chapter: ChapterMeta, index: number): string {
  return chapter.number ?? (chapter.part || chapter.label ? "" : String(index + 1));
}
