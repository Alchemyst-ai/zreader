import type { ComponentType } from "react";
import type { BookMeta } from "zreader";

/**
 * The catalogue, built from the files in this folder:
 *
 *   ./<book>/book.json             → book metadata
 *   ./<book>/01-<chapter>.mdx      → a chapter (exports `meta`)
 */
type ChapterModule = { default: ComponentType<{ components?: Record<string, unknown> }>; meta: { title: string; description?: string } };

const bookFiles = import.meta.glob<Omit<BookMeta, "id" | "chapters">>("./*/book.json", { eager: true, import: "default" });
const chapterFiles = import.meta.glob<ChapterModule>("./*/*.mdx", { eager: true });

const contents = new Map<string, ChapterModule["default"]>();
const chaptersByBook = new Map<string, BookMeta["chapters"]>();

for (const [path, mod] of Object.entries(chapterFiles).sort(([a], [b]) => a.localeCompare(b))) {
  const [, book, file] = /^\.\/([^/]+)\/(.+)\.mdx$/.exec(path)!;
  const order = Number(/^(\d+)/.exec(file!)?.[1] ?? 0);
  const id = file!.replace(/^\d+[-_.]/, "");
  contents.set(`${book}/${id}`, mod.default);
  const list = chaptersByBook.get(book!) ?? [];
  list.push({ id, title: mod.meta.title, order, ...(mod.meta.description ? { description: mod.meta.description } : {}) });
  chaptersByBook.set(book!, list);
}

export const books: BookMeta[] = Object.entries(bookFiles).map(([path, meta]) => {
  const id = /^\.\/([^/]+)\//.exec(path)![1]!;
  return { ...meta, id, authors: meta.authors ?? [], chapters: chaptersByBook.get(id) ?? [] };
});

export function chapterContent(book: string, chapter: string) {
  return contents.get(`${book}/${chapter}`);
}
