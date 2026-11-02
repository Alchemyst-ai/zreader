/**
 * `zreader/rehype` — the block-id plugin for any MDX/Markdown
 * pipeline (Vite's @mdx-js/rollup, @next/mdx, unified…). Runs anywhere: no Node APIs.
 *
 *   // vite.config.ts
 *   mdx({ rehypePlugins: [rehypeBlocks] })
 *
 * Without it, <Reader> assigns the same ids in the browser; with it, they are in
 * the HTML from the start.
 */
import { toString } from "hast-util-to-string";
import type { Element, Root } from "hast";
import { visit } from "unist-util-visit";
import type { VFile } from "vfile";
import { BLOCK_TAGS, createBlockIdAllocator, createSlugger, hashString, normalizeBlockText } from "../core/blocks";
import type { TocEntry } from "../core/types";

const HEADING = /^h([1-6])$/;

export interface BlockInfo {
  id: string;
  tag: string;
  /** First 80 chars, for bookmarks/progress UIs. */
  excerpt: string;
}

export interface BlocksData {
  toc: TocEntry[];
  blocks: BlockInfo[];
  contentHash: string;
}

function containsBlock(node: Element): boolean {
  for (const child of node.children) {
    if (child.type === "element" && (BLOCK_TAGS.has(child.tagName) || containsBlock(child))) return true;
  }
  return false;
}

export interface RehypeBlocksOptions {
  /** Heading depths included in the TOC. Default: 2–3 (h1 is the chapter title). */
  tocDepth?: [min: number, max: number];
}

/**
 * Adds stable `data-block-id` attributes to leaf blocks, slug `id`s to headings,
 * and collects `{ toc, blocks, contentHash }` into `file.data.reader`.
 */
export function rehypeBlocks(options: RehypeBlocksOptions = {}) {
  const [minDepth, maxDepth] = options.tocDepth ?? [2, 3];
  return (tree: Root, file: VFile) => {
    const slugger = createSlugger();
    const allocate = createBlockIdAllocator();
    const toc: TocEntry[] = [];
    const blocks: BlockInfo[] = [];
    const texts: string[] = [];

    visit(tree, "element", (node: Element) => {
      if (!BLOCK_TAGS.has(node.tagName)) return;
      const text = normalizeBlockText(toString(node));
      const heading = HEADING.exec(node.tagName);
      node.properties ??= {};

      if (heading) {
        const existing = typeof node.properties.id === "string" ? node.properties.id : "";
        const id = existing ? slugger.keep(existing) : slugger.slug(text);
        node.properties.id = id;
        const depth = Number(heading[1]);
        if (depth >= minDepth && depth <= maxDepth && text) toc.push({ id, depth, text });
      }

      if (containsBlock(node)) return; // only innermost blocks are anchors
      if (!text) return;
      const id = allocate(node.tagName, text);
      node.properties.dataBlockId = id;
      blocks.push({ id, tag: node.tagName, excerpt: text.slice(0, 80) });
      texts.push(text);
    });

    const data: BlocksData = { toc, blocks, contentHash: hashString(texts.join("\n")) };
    (file.data as { reader?: BlocksData }).reader = data;
  };
}

export default rehypeBlocks;
