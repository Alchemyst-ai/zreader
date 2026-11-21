import { mkdtempSync, mkdirSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { defineBooks, matchAssetRoute, resolveBookAsset, serveAsset } from "../src/content/index";
import { resolveConfig } from "../src/config/index";
import { createAgentHandler } from "../src/agent/index";
import { agentMatcher } from "../src/next/server/index";

function pngOf(width: number, height: number): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "zr-assets-"));
  const book = join(root, "content/books/physics");
  mkdirSync(join(book, "images"), { recursive: true });
  mkdirSync(join(book, ".secret"), { recursive: true });
  writeFileSync(join(book, "book.json"), JSON.stringify({ title: "Physics", cover: "./images/cover.png" }));
  writeFileSync(join(book, "images", "diagram.png"), pngOf(800, 600));
  writeFileSync(join(book, "images", "cover.png"), pngOf(300, 400));
  writeFileSync(join(book, "images", "logo.svg"), `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>`);
  writeFileSync(join(book, "images", "notes.txt"), "text");
  writeFileSync(join(book, ".secret", "x.png"), pngOf(1, 1));
  writeFileSync(join(root, "outside.png"), pngOf(1, 1));
  symlinkSync(join(root, "outside.png"), join(book, "images", "link.png"));
  writeFileSync(
    join(book, "01-intro.md"),
    "---\ntitle: Intro\n---\n\n![Diagram](./images/diagram.png)\n\n![Up](../../../outside.png)\n\n![Link](images/link.png)\n\n![Txt](./images/notes.txt)\n",
  );
  return { root, book };
}

const assets = { route: "_assets", extensions: ["png", "jpg", "svg"] };

describe("resolveBookAsset", () => {
  it("maps a relative path to a hashed asset URL", async () => {
    const { book } = fixture();
    const r = await resolveBookAsset("./images/diagram.png", { fromFile: join(book, "01-intro.md"), bookDir: book, bookId: "physics", basePath: "/books", assets });
    expect(r).toMatchObject({ url: expect.stringMatching(/^\/books\/physics\/_assets\/[0-9a-f]{10}\/images\/diagram\.png$/) });
  });

  it("refuses traversal, hidden files, symlinks out and other extensions", async () => {
    const { book } = fixture();
    const ctx = { fromFile: join(book, "01-intro.md"), bookDir: book, bookId: "physics", basePath: "/", assets };
    expect(await resolveBookAsset("../../../outside.png", ctx)).toBe("outside the book folder");
    expect(await resolveBookAsset("./.secret/x.png", ctx)).toBe("hidden files are not served");
    expect(await resolveBookAsset("./images/link.png", ctx)).toBe("links outside the book folder");
    expect(await resolveBookAsset("./images/notes.txt", ctx)).toMatch(/not in content\.assets\.extensions/);
    expect(await resolveBookAsset("./images/missing.png", ctx)).toBe("file not found");
  });
});

describe("matchAssetRoute", () => {
  it("matches only well-formed asset URLs", () => {
    expect(matchAssetRoute("/books/physics/_assets/abcdef1234/images/a.png", "/books", "_assets")).toEqual({ book: "physics", hash: "abcdef1234", path: ["images", "a.png"] });
    expect(matchAssetRoute("/physics/_assets/abcdef1234/a.png", "/", "_assets")).toMatchObject({ book: "physics" });
    expect(matchAssetRoute("/books/physics/_assets/zzz/a.png", "/books", "_assets")).toBeNull();
    expect(matchAssetRoute("/books/physics/_assets/abcdef1234/../a.png", "/books", "_assets")).toBeNull();
    expect(matchAssetRoute("/books/physics/_assets/abcdef1234/%2e%2e/a.png", "/books", "_assets")).toBeNull();
    expect(matchAssetRoute("/books/physics/_assets/abcdef1234/a%2Fb.png", "/books", "_assets")).toBeNull();
    expect(matchAssetRoute("/books/physics/_assets/abcdef1234/.env", "/books", "_assets")).toBeNull();
    expect(matchAssetRoute("/books/physics/intro", "/books", "_assets")).toBeNull();
  });
});

describe("serveAsset", () => {
  const opts = (book: string) => ({ basePath: "/books", assets, bookDir: async (id: string) => (id === "physics" ? book : null) });
  const req = (path: string, init?: RequestInit) => new Request(`https://x.dev${path}`, init);

  it("serves files with immutable caching, ETag and nosniff", async () => {
    const { book } = fixture();
    const res = (await serveAsset(req("/books/physics/_assets/abcdef1234/images/diagram.png"), opts(book)))!;
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await res.arrayBuffer()).byteLength).toBe(33);
    const again = (await serveAsset(req("/books/physics/_assets/abcdef1234/images/diagram.png", { headers: { "If-None-Match": res.headers.get("etag")! } }), opts(book)))!;
    expect(again.status).toBe(304);
  });

  it("sends SVG with a strict CSP", async () => {
    const { book } = fixture();
    const res = (await serveAsset(req("/books/physics/_assets/abcdef1234/images/logo.svg"), opts(book)))!;
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
  });

  it("404s unknown books, missing files, symlinks out and other types; ignores other URLs", async () => {
    const { book } = fixture();
    for (const path of [
      "/books/nope/_assets/abcdef1234/images/diagram.png",
      "/books/physics/_assets/abcdef1234/images/missing.png",
      "/books/physics/_assets/abcdef1234/images/link.png",
      "/books/physics/_assets/abcdef1234/images/notes.txt",
      "/books/physics/_assets/abcdef1234/book.json",
    ]) {
      expect((await serveAsset(req(path), opts(book)))!.status, path).toBe(404);
    }
    expect(await serveAsset(req("/books/physics/intro"), opts(book))).toBeUndefined();
    expect(await serveAsset(req("/books/physics/_assets/abcdef1234/images/diagram.png", { method: "POST" }), opts(book))).toBeUndefined();
  });
});

describe("assets in compiled chapters", () => {
  it("rewrites relative images, measures them, drops refused ones and resolves the cover", async () => {
    const { root } = fixture();
    const warn = console.warn;
    const warnings: string[] = [];
    console.warn = (m: string) => warnings.push(m);
    try {
      const api = defineBooks(resolveConfig({ content: { cacheDir: join(root, ".cache") } }, null, { root }));
      const [book] = await api.getBooks();
      expect(book!.cover).toMatch(/^\/books\/physics\/_assets\/[0-9a-f]{10}\/images\/cover\.png$/);
      const r = await api.renderChapter((await api.getChapter("physics", "intro"))!.chapter);
      const html = r.kind === "html" ? r.html : "";
      expect(html).toMatch(/<img src="\/books\/physics\/_assets\/[0-9a-f]{10}\/images\/diagram\.png" alt="Diagram" width="800" height="600"/);
      expect(html).not.toContain("outside.png");
      expect(html).not.toContain("link.png");
      expect(html).not.toContain("notes.txt");
      expect(warnings.join("\n")).toMatch(/outside the book folder/);
    } finally {
      console.warn = warn;
    }
  });

  it("recompiles in development when an image changes (new hash)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { root, book } = fixture();
    const config = resolveConfig({ content: { cacheDir: join(root, ".cache") } }, null, { root });
    const first = await defineBooks(config).renderChapter((await defineBooks(config).getChapter("physics", "intro"))!.chapter);
    writeFileSync(join(book, "images", "diagram.png"), pngOf(1024, 768));
    const later = new Date(Date.now() + 5000);
    utimesSync(join(book, "images", "diagram.png"), later, later);
    const second = await defineBooks(resolveConfig({ content: { cacheDir: join(root, ".cache") } }, null, { root })).renderChapter(
      (await defineBooks(config).getChapter("physics", "intro"))!.chapter,
    );
    const a = first.kind === "html" ? first.html : "";
    const b = second.kind === "html" ? second.html : "";
    expect(a).not.toBe(b);
    expect(b).toContain('width="1024" height="768"');
    vi.unstubAllEnvs();
  });

  it("is served by the agent handler, and the matcher covers it", async () => {
    const { root, book } = fixture();
    const shelf = resolveConfig({}, null, { root }).shelves[0]!;
    const handler = createAgentHandler({ sources: [{ shelf, api: { getBooks: async () => [], getBook: async () => ({ dir: book }) as never, getChapter: async () => null } }] });
    const res = await handler(new Request("https://x.dev/books/physics/_assets/abcdef1234/images/diagram.png"));
    expect(res?.status).toBe(200);
    expect(res?.headers.get("content-type")).toBe("image/png");
    expect(agentMatcher(shelf)).toContain("/books/:book/_assets/:path*");
  });
});
