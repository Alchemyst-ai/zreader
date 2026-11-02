/**
 * Block ids and heading slugs, shared by the build-time rehype plugin
 * (`zreader/rehype`) and the in-browser fallback in <Reader>, so
 * both produce identical ids for the same content. No Node APIs.
 */
import GithubSlugger from "github-slugger";

export const BLOCK_TAG_NAMES = [
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "blockquote",
  "pre",
  "figcaption",
  "td",
  "th",
  "dt",
  "dd",
] as const;

export const BLOCK_TAGS: ReadonlySet<string> = new Set(BLOCK_TAG_NAMES);

/** Collapse whitespace the same way on the server (hast) and in the DOM. */
export function normalizeBlockText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** cyrb53: a fast, well-distributed 53-bit string hash (public domain). */
function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** Hex digest of `text`, `length` characters long (up to 26). */
export function hashString(text: string, length = 16): string {
  const hex = cyrb53(text, 0).toString(16).padStart(14, "0") + cyrb53(text, 0x9e3779b9).toString(16).padStart(14, "0");
  return hex.slice(0, length);
}

/**
 * Allocates content-derived block ids (`p-3fa9c1`) for one chapter. Inserting a
 * paragraph doesn't shift other blocks' ids; repeated text gets `-2`, `-3`…
 */
export function createBlockIdAllocator() {
  const seen = new Map<string, number>();
  return (tag: string, text: string): string => {
    const base = `${tag.toLowerCase()}-${hashString(normalizeBlockText(text), 6)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };
}

/** GitHub-style heading slugs, unique within one chapter. */
export function createSlugger() {
  const slugger = new GithubSlugger();
  return {
    /** Slug for a heading's text. */
    slug: (text: string) => slugger.slug(text || "section"),
    /** Keep an author-supplied id (made unique). */
    keep: (id: string) => slugger.slug(id, true),
  };
}
