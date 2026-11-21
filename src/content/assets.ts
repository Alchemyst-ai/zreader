/**
 * Book assets: files that live next to chapters (`content/books/<book>/images/x.png`)
 * and are served by zreader at
 *
 *   {basePath}/{book}/{route}/{hash}/{path}      e.g. /books/physics/_assets/3f2a9c10de/images/x.png
 *
 * `{hash}` is part of the file's content hash, so responses are immutable and a
 * changed file gets a new URL. Server-only.
 */
import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { AssetOptions } from "../config/index";
import type { ResolvedLocalImage } from "./images";

export const ASSET_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
  apng: "image/apng",
};

/** Served with every SVG: no scripts, no external loads, sandboxed when opened directly. */
export const SVG_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox";

function insideDir(dir: string, file: string): boolean {
  const rel = relative(dir, file);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

function extOf(path: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(path);
  return m ? m[1]!.toLowerCase() : "";
}

function baseOf(basePath: string): string {
  return basePath.replace(/\/+$/, "");
}

const hashes = new Map<string, { mtimeMs: number; size: number; hash: string }>();

async function contentHash(file: string): Promise<string> {
  const st = await stat(file);
  const hit = hashes.get(file);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.hash;
  const hash = createHash("sha1").update(await readFile(file)).digest("hex").slice(0, 10);
  hashes.set(file, { mtimeMs: st.mtimeMs, size: st.size, hash });
  return hash;
}

export interface BookAssetContext {
  /** The file the path is relative to (a chapter, or book.json for covers). */
  fromFile: string;
  /** The book folder. Nothing outside it is served. */
  bookDir: string;
  bookId: string;
  /** The shelf's `basePath`. */
  basePath: string;
  assets: AssetOptions;
}

export function assetUrl(ctx: Pick<BookAssetContext, "basePath" | "bookId" | "assets">, hash: string, relPath: string): string {
  const path = relPath.split(/[\\/]/).map(encodeURIComponent).join("/");
  return `${baseOf(ctx.basePath)}/${encodeURIComponent(ctx.bookId)}/${ctx.assets.route}/${hash}/${path}`;
}

/**
 * Resolve a relative path from a chapter (or book.json) to its asset URL.
 * Returns a reason string when the path cannot be served.
 */
export async function resolveBookAsset(src: string, ctx: BookAssetContext): Promise<ResolvedLocalImage | string> {
  let pathPart = src.split(/[?#]/)[0]!;
  try {
    pathPart = decodeURIComponent(pathPart);
  } catch {
    return "malformed path";
  }
  if (!pathPart || pathPart.includes("\0")) return "malformed path";
  const file = resolve(dirname(ctx.fromFile), pathPart);
  if (!insideDir(ctx.bookDir, file)) return "outside the book folder";
  const segs = relative(ctx.bookDir, file).split(sep);
  if (segs.some((s) => s.startsWith("."))) return "hidden files are not served";
  const ext = extOf(file);
  if (!ctx.assets.extensions.map((e) => e.toLowerCase()).includes(ext)) return `.${ext || "(none)"} is not in content.assets.extensions`;
  let real: string;
  try {
    const [rf, rd] = await Promise.all([realpath(file), realpath(ctx.bookDir)]);
    if (!insideDir(rd, rf)) return "links outside the book folder";
    if (!(await stat(rf)).isFile()) return "not a file";
    real = rf;
  } catch {
    return "file not found";
  }
  return { url: assetUrl(ctx, await contentHash(real), segs.join("/")), file: real };
}

// ---------------------------------------------------------------- serving

export interface AssetRouteMatch {
  book: string;
  hash: string;
  /** Path segments inside the book folder. */
  path: string[];
}

/** Match `{basePath}/{book}/{route}/{hash}/{...path}` (pure). */
export function matchAssetRoute(pathname: string, basePath: string, route: string): AssetRouteMatch | null {
  const base = baseOf(basePath);
  if (!pathname.startsWith(`${base}/`)) return null;
  const raw = pathname.slice(base.length + 1).split("/");
  if (raw.length < 4 || raw[1] !== route) return null;
  const segs: string[] = [];
  for (const r of raw) {
    let s: string;
    try {
      s = decodeURIComponent(r);
    } catch {
      return null;
    }
    if (!s || s === "." || s === ".." || /[\\/\0]/.test(s)) return null;
    segs.push(s);
  }
  const [book, , hash, ...path] = segs;
  if (!/^[0-9a-f]{6,64}$/i.test(hash!)) return null;
  if (path.some((p) => p.startsWith("."))) return null;
  return { book: book!, hash: hash!, path };
}

export interface ServeAssetOptions {
  basePath: string;
  assets: AssetOptions;
  /** The folder of a book, or `null` when there is no such book. */
  bookDir(bookId: string): Promise<string | null>;
  cacheControl?: string;
}

const IMMUTABLE = "public, max-age=31536000, immutable";

function notFound(request: Request): Response {
  return new Response(request.method === "HEAD" ? null : "Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

/**
 * Serve one book asset. `undefined` when the URL is not an asset URL (so it
 * composes with other handlers); a 404 for unknown or refused files.
 */
export async function serveAsset(request: Request, options: ServeAssetOptions): Promise<Response | undefined> {
  if (request.method !== "GET" && request.method !== "HEAD") return undefined;
  const match = matchAssetRoute(new URL(request.url).pathname, options.basePath, options.assets.route);
  if (!match) return undefined;
  const ext = extOf(match.path[match.path.length - 1]!);
  const type = ASSET_TYPES[ext];
  if (!type || !options.assets.extensions.map((e) => e.toLowerCase()).includes(ext)) return notFound(request);
  const dir = await options.bookDir(match.book);
  if (!dir) return notFound(request);
  let file: string;
  let size: number;
  let mtimeMs: number;
  try {
    const rd = await realpath(dir);
    file = await realpath(join(rd, ...match.path));
    if (!insideDir(rd, file)) return notFound(request);
    const st = await stat(file);
    if (!st.isFile()) return notFound(request);
    size = st.size;
    mtimeMs = st.mtimeMs;
  } catch {
    return notFound(request);
  }
  const etag = `"${createHash("sha1").update(`${file}:${size}:${mtimeMs}`).digest("hex").slice(0, 16)}"`;
  const headers = new Headers({
    "Content-Type": type,
    "Cache-Control": options.cacheControl ?? IMMUTABLE,
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-site",
  });
  if (ext === "svg") headers.set("Content-Security-Policy", SVG_CSP);
  const inm = request.headers.get("if-none-match");
  if (inm && inm.split(",").some((t) => t.trim() === etag || t.trim() === "*")) return new Response(null, { status: 304, headers });
  headers.set("Content-Length", String(size));
  if (request.method === "HEAD") return new Response(null, { status: 200, headers });
  return new Response(new Uint8Array(await readFile(file)), { status: 200, headers });
}
