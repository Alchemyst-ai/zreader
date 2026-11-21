/**
 * Image handling for compiled chapters: which sources are allowed (remote URLs,
 * base64 data URIs, relative paths), their sizes, captions and viewer hints.
 *
 * Runs after sanitizing for `.md`/`.html` and before block ids for every format.
 */
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { Element, ElementContent, Parents, Root } from "hast";
import { imageSize } from "image-size";
import { visitParents } from "unist-util-visit-parents";
import { defaultImageOptions, type ImageOptions } from "../config/index";
import { parseSrcset, stringifySrcset, type SrcsetCandidate } from "./srcset";

export interface ImageDimensions {
  width: number;
  height: number;
}

/** A relative image path resolved to a public URL (and, for measuring, a file). */
export interface ResolvedLocalImage {
  url: string;
  file?: string;
}

export interface ImagePipelineOptions {
  images?: Partial<ImageOptions>;
  /** Chapter file, used in warnings. */
  source?: string;
  /**
   * Resolves a relative `src` (`./images/x.png`). Return a reason string (or
   * `null`) to drop the image, for example a path outside the book folder.
   * Without a resolver, relative paths are left as written.
   */
  resolveLocal?: (src: string) => ResolvedLocalImage | string | null | Promise<ResolvedLocalImage | string | null>;
  /** Where root-relative URLs (`/x.png`) live on disk, for measuring. Usually `<root>/public`. */
  publicDir?: string;
  /** Override the warning sink (tests). */
  warn?: (message: string) => void;
}

export type ImageUrlKind = "data" | "remote" | "root" | "relative" | "other";

const DATA_URI = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+)?((?:;[a-z0-9-]+=[^;,]*)*)(;base64)?,(.*)$/is;
const RASTER_DATA = new Set(["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp", "image/avif", "image/bmp", "image/x-icon", "image/vnd.microsoft.icon"]);

export function classifyImageUrl(src: string): ImageUrlKind {
  const s = src.trim();
  if (/^data:/i.test(s)) return "data";
  if (/^https?:\/\//i.test(s) || s.startsWith("//")) return "remote";
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return "other";
  if (s.startsWith("/")) return "root";
  return "relative";
}

export interface DataUriInfo {
  mime: string;
  base64: boolean;
  /** Decoded size in bytes. */
  bytes: number;
  payload: string;
}

export function parseDataUri(src: string): DataUriInfo | null {
  const m = DATA_URI.exec(src.trim());
  if (!m) return null;
  const mime = (m[1] ?? "text/plain").toLowerCase();
  const base64 = Boolean(m[3]);
  const payload = m[4] ?? "";
  let bytes: number;
  if (base64) {
    const clean = payload.replace(/\s+/g, "");
    const pad = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
    bytes = Math.max(0, Math.floor((clean.length * 3) / 4) - pad);
  } else {
    try {
      bytes = Buffer.byteLength(decodeURIComponent(payload));
    } catch {
      bytes = payload.length;
    }
  }
  return { mime, base64, bytes, payload };
}

function hostOf(src: string): string | null {
  try {
    return new URL(src.startsWith("//") ? `https:${src}` : src).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function hostAllowed(host: string, allow: string[]): boolean {
  const h = host.toLowerCase();
  return allow.some((a) => {
    const x = a.toLowerCase().replace(/^\*\./, "");
    return h === x || h.endsWith(`.${x}`);
  });
}

export type ImageVerdict = { ok: true; kind: ImageUrlKind; data?: DataUriInfo } | { ok: false; reason: string };

/** Is this image URL allowed by the options? Size totals are checked by the caller. */
export function checkImageUrl(src: string, options: Partial<ImageOptions> = {}): ImageVerdict {
  const o = { ...defaultImageOptions(), ...options };
  const kind = classifyImageUrl(src);
  switch (kind) {
    case "other":
      return { ok: false, reason: "unsupported URL scheme" };
    case "remote": {
      if (o.allowRemote === false) return { ok: false, reason: "remote images are disabled (content.images.allowRemote)" };
      if (Array.isArray(o.allowRemote)) {
        const host = hostOf(src);
        if (!host || !hostAllowed(host, o.allowRemote)) return { ok: false, reason: `host ${host ?? "?"} is not in content.images.allowRemote` };
      }
      return { ok: true, kind };
    }
    case "data": {
      if (!o.allowDataUri) return { ok: false, reason: "data URIs are disabled (content.images.allowDataUri)" };
      const data = parseDataUri(src);
      if (!data) return { ok: false, reason: "malformed data URI" };
      const svg = data.mime === "image/svg+xml";
      if (svg && !o.allowSvgDataUri) return { ok: false, reason: "SVG data URIs are disabled (content.images.allowSvgDataUri)" };
      if (!svg && !RASTER_DATA.has(data.mime)) return { ok: false, reason: `${data.mime} is not an image type` };
      if (!svg && !data.base64) return { ok: false, reason: "raster data URIs must be base64" };
      if (data.bytes > o.maxDataUriBytes) {
        return { ok: false, reason: `inline image is ${formatBytes(data.bytes)}, over content.images.maxDataUriBytes (${formatBytes(o.maxDataUriBytes)})` };
      }
      return { ok: true, kind, data };
    }
    default:
      return { ok: true, kind };
  }
}

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

export { parseSrcset, stringifySrcset, type SrcsetCandidate } from "./srcset";

// --------------------------------------------------------------- measuring

const remoteSizes = new Map<string, Promise<ImageDimensions | null>>();

function measureBuffer(buf: Uint8Array): ImageDimensions | null {
  try {
    const r = imageSize(buf);
    if (!r.width || !r.height) return null;
    // EXIF orientations 5–8 swap the axes.
    const swap = r.orientation != null && r.orientation >= 5;
    return swap ? { width: r.height, height: r.width } : { width: r.width, height: r.height };
  } catch {
    return null;
  }
}

export async function measureFile(file: string): Promise<ImageDimensions | null> {
  try {
    return measureBuffer(await readFile(file));
  } catch {
    return null;
  }
}

export function measureDataUri(info: DataUriInfo): ImageDimensions | null {
  if (info.base64) return measureBuffer(Buffer.from(info.payload.replace(/\s+/g, ""), "base64"));
  if (info.mime === "image/svg+xml") {
    try {
      return measureBuffer(Buffer.from(decodeURIComponent(info.payload)));
    } catch {
      return null;
    }
  }
  return null;
}

const PROBE_BYTES = 128 * 1024;

export function probeRemoteImage(src: string, timeoutMs: number): Promise<ImageDimensions | null> {
  const url = src.startsWith("//") ? `https:${src}` : src;
  let p = remoteSizes.get(url);
  if (!p) {
    p = (async () => {
      try {
        const res = await fetch(url, { headers: { Range: `bytes=0-${PROBE_BYTES - 1}` }, signal: AbortSignal.timeout(timeoutMs) });
        if (!res.ok || !res.body) return null;
        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        while (total < PROBE_BYTES) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          total += value.byteLength;
        }
        void reader.cancel().catch(() => {});
        return measureBuffer(Buffer.concat(chunks));
      } catch {
        return null;
      }
    })();
    remoteSizes.set(url, p);
  }
  return p;
}

function insideDir(dir: string, file: string): boolean {
  const rel = relative(dir, file);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

// ------------------------------------------------------------- the plugin

const BLOCK_CONTAINERS = new Set(["p", "#root", "div", "section", "article", "li", "td", "th", "dd", "blockquote"]);

function isWhitespace(node: ElementContent): boolean {
  return node.type === "text" && !node.value.trim();
}

function propString(el: Element, name: string): string | undefined {
  const v = el.properties?.[name];
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.join(name === "srcSet" ? "," : " ");
  if (typeof v === "number") return String(v);
  return undefined;
}

function positiveNumber(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\s*\d+(\.\d+)?\s*$/.test(v) ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** The only meaningful child of `parent` (whitespace aside), if it is `el`. */
function aloneIn(parent: Parents | undefined, el: Element): boolean {
  if (!parent || !("children" in parent)) return false;
  const kids = (parent.children as ElementContent[]).filter((c) => !isWhitespace(c));
  return kids.length === 1 && kids[0] === el;
}

function defaultWarn(message: string) {
  console.warn(`[zreader] ${message}`);
}

function isDev() {
  return typeof process !== "undefined" && process.env?.NODE_ENV === "development";
}

/**
 * rehype plugin: enforces `content.images`, rewrites relative paths, measures
 * images, adds lazy loading, captions and viewer hints.
 *
 * Adds `data-zr-image="block"` to images that stand alone in a paragraph, link or
 * figure (and `"inline"` otherwise), and `data-zr-zoom` to block images the viewer
 * may open.
 */
export function rehypeImages(options: ImagePipelineOptions = {}) {
  const o: ImageOptions = { ...defaultImageOptions(), ...options.images };
  const warn = options.warn ?? defaultWarn;
  const where = options.source ? `${options.source}: ` : "";

  return async (tree: Root) => {
    const imgs: Array<{ node: Element; ancestors: Parents[] }> = [];
    const sources: Array<{ node: Element; ancestors: Parents[] }> = [];
    visitParents(tree, "element", (node: Element, ancestors: Parents[]) => {
      if (node.tagName === "img") imgs.push({ node, ancestors: [...ancestors] });
      else if (node.tagName === "source" && ancestors.some((a) => a.type === "element" && a.tagName === "picture")) {
        sources.push({ node, ancestors: [...ancestors] });
      }
    });

    let dataTotal = 0;
    const remove = (node: Element, ancestors: Parents[]) => {
      const parent = ancestors[ancestors.length - 1];
      if (parent && "children" in parent) {
        const kids = parent.children as ElementContent[];
        const i = kids.indexOf(node);
        if (i >= 0) kids.splice(i, 1);
      }
    };

    const admit = async (src: string, what: string): Promise<{ url: string; file?: string; data?: ReturnType<typeof parseDataUri> } | null> => {
      const verdict = checkImageUrl(src, o);
      if (!verdict.ok) {
        warn(`${where}dropped ${what} (${verdict.reason}): ${abbreviate(src)}`);
        return null;
      }
      if (verdict.kind === "data" && verdict.data) {
        const next = dataTotal + verdict.data.bytes;
        if (o.maxDataUriTotalBytes != null && next > o.maxDataUriTotalBytes) {
          warn(`${where}dropped ${what}: inline images would total ${formatBytes(next)}, over content.images.maxDataUriTotalBytes (${formatBytes(o.maxDataUriTotalBytes)})`);
          return null;
        }
        dataTotal = next;
        return { url: src, data: verdict.data };
      }
      if (verdict.kind === "relative" && options.resolveLocal) {
        const local = await options.resolveLocal(src);
        if (!local || typeof local === "string") {
          warn(`${where}dropped ${what} ${src}: ${local || "cannot be served"}`);
          return null;
        }
        return local;
      }
      if (verdict.kind === "root" && options.publicDir) {
        const pathname = decodeSafe(src.split(/[?#]/)[0]!);
        const file = resolve(options.publicDir, `.${pathname}`);
        return insideDir(options.publicDir, file) ? { url: src, file } : { url: src };
      }
      return { url: src };
    };

    const filterSrcset = async (el: Element, what: string): Promise<boolean> => {
      const raw = propString(el, "srcSet");
      if (raw == null) return true;
      const kept: SrcsetCandidate[] = [];
      for (const c of parseSrcset(raw)) {
        const ok = await admit(c.url, `${what} srcset candidate`);
        if (ok) kept.push({ url: ok.url, descriptor: c.descriptor });
      }
      if (kept.length) el.properties.srcSet = stringifySrcset(kept);
      else delete el.properties.srcSet;
      return kept.length > 0;
    };

    for (const { node, ancestors } of sources) {
      node.properties ??= {};
      if (!(await filterSrcset(node, "<source>"))) remove(node, ancestors);
    }

    await Promise.all(
      imgs.map(async ({ node, ancestors }) => {
        node.properties ??= {};
        const props = node.properties;
        const src = propString(node, "src")?.trim();
        if (!src) {
          if (propString(node, "srcSet") == null) remove(node, ancestors);
          else await filterSrcset(node, "image");
          return;
        }
        const admitted = await admit(src, "image");
        if (!admitted) {
          remove(node, ancestors);
          return;
        }
        props.src = admitted.url;
        await filterSrcset(node, "image");

        let width = positiveNumber(props.width);
        let height = positiveNumber(props.height);
        if (width == null || height == null) {
          const kind = classifyImageUrl(admitted.url);
          const dims = admitted.data
            ? measureDataUri(admitted.data)
            : admitted.file
              ? await measureFile(admitted.file)
              : kind === "remote" && o.probeRemote
                ? await probeRemoteImage(admitted.url, o.probeTimeoutMs)
                : null;
          if (dims) {
            if (width == null && height == null) {
              width = dims.width;
              height = dims.height;
            } else if (width != null) {
              height = Math.round((width * dims.height) / dims.width);
            } else if (height != null) {
              width = Math.round((height * dims.width) / dims.height);
            }
          }
        }
        if (width != null) props.width = Math.round(width);
        if (height != null) props.height = Math.round(height);

        if (o.lazy) {
          props.loading ??= "lazy";
          props.decoding ??= "async";
        }

        // Block vs inline: alone in <p>, <figure>, or a link/picture that is itself alone.
        const parent = ancestors[ancestors.length - 1];
        const grand = ancestors[ancestors.length - 2];
        const wrapper = parent?.type === "element" && (parent.tagName === "a" || parent.tagName === "picture") ? parent : null;
        const container = wrapper ? grand : parent;
        const subject = wrapper ?? node;
        const containerTag = container?.type === "element" ? container.tagName : container?.type === "root" ? "#root" : "";
        const block = containerTag === "figure" || (BLOCK_CONTAINERS.has(containerTag) && aloneIn(container, subject));
        props.dataZrImage = block ? "block" : "inline";
        const inLink = ancestors.some((a) => a.type === "element" && a.tagName === "a");
        if (o.lightbox && block && !inLink) {
          props.dataZrZoom = "";
          props.tabIndex ??= 0;
          props.ariaHasPopup ??= "dialog";
        }

        // ![alt](src "title") alone in a paragraph → <figure> with the title as caption.
        const title = propString(node, "title")?.trim();
        if (o.captions && title && !wrapper && parent?.type === "element" && parent.tagName === "p" && aloneIn(parent, node)) {
          delete props.title;
          parent.tagName = "figure";
          parent.properties = {};
          parent.children = [node, { type: "element", tagName: "figcaption", properties: {}, children: [{ type: "text", value: title }] }];
        }
      }),
    );

    if (isDev() && dataTotal > o.warnDataUriTotalBytes) {
      warn(
        `${where}inline (base64) images total ${formatBytes(dataTotal)}. They are sent with every page view (twice under React Server Components); ` +
          `move large images next to the chapter (./images/…) so they are served and cached as files.`,
      );
    }
  };
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function abbreviate(src: string): string {
  return src.length > 80 ? `${src.slice(0, 60)}…(${src.length} chars)` : src;
}

export default rehypeImages;
