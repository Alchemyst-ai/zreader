import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { compileMdx, renderHtml, renderMarkdown, sanitizeHtml } from "../src/content/index";
import { checkImageUrl, parseDataUri, parseSrcset } from "../src/content/images";
import { resolveConfig } from "../src/config/index";

// 1×1 transparent PNG.
const PNG_1x1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

/** A real PNG header with the given size (enough for image-size). */
function pngOf(width: number, height: number): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

const quiet = { warn: () => {} };

describe("image URL policy", () => {
  it("classifies and allows remote, data, root and relative URLs by default", () => {
    expect(checkImageUrl("https://cdn.example/a.png")).toMatchObject({ ok: true, kind: "remote" });
    expect(checkImageUrl("//cdn.example/a.png")).toMatchObject({ ok: true, kind: "remote" });
    expect(checkImageUrl(PNG_1x1)).toMatchObject({ ok: true, kind: "data" });
    expect(checkImageUrl("/img/a.png")).toMatchObject({ ok: true, kind: "root" });
    expect(checkImageUrl("./a.png")).toMatchObject({ ok: true, kind: "relative" });
  });

  it("rejects other schemes, non-image data and SVG data unless allowed", () => {
    expect(checkImageUrl("javascript:alert(1)").ok).toBe(false);
    expect(checkImageUrl("file:///etc/passwd").ok).toBe(false);
    expect(checkImageUrl("data:text/html;base64,PHA+").ok).toBe(false);
    expect(checkImageUrl("data:image/svg+xml,%3Csvg%2F%3E").ok).toBe(false);
    expect(checkImageUrl("data:image/svg+xml,%3Csvg%2F%3E", { allowSvgDataUri: true }).ok).toBe(true);
  });

  it("applies the remote allowlist, with subdomains", () => {
    const opts = { allowRemote: ["example.com"] };
    expect(checkImageUrl("https://example.com/a.png", opts).ok).toBe(true);
    expect(checkImageUrl("https://cdn.example.com/a.png", opts).ok).toBe(true);
    expect(checkImageUrl("https://evil.dev/a.png", opts).ok).toBe(false);
    expect(checkImageUrl("https://example.com/a.png", { allowRemote: false }).ok).toBe(false);
  });

  it("measures data URI size and enforces maxDataUriBytes", () => {
    expect(parseDataUri(PNG_1x1)).toMatchObject({ mime: "image/png", base64: true, bytes: 68 });
    expect(checkImageUrl(PNG_1x1, { maxDataUriBytes: 67 }).ok).toBe(false);
    expect(checkImageUrl(PNG_1x1, { maxDataUriBytes: 68 }).ok).toBe(true);
  });

  it("parses srcset without splitting data URIs", () => {
    expect(parseSrcset(`a.png 1x, ${PNG_1x1} 2x,c.png`)).toEqual([
      { url: "a.png", descriptor: "1x" },
      { url: PNG_1x1, descriptor: "2x" },
      { url: "c.png", descriptor: "" },
    ]);
  });
});

describe("sanitizer and images", () => {
  it("keeps srcset, sizes, width, height and <picture> sources", () => {
    const out = sanitizeHtml(`<picture><source srcset="a.webp 1x, b.webp 2x" type="image/webp"><img src="a.png" srcset="a.png 1x" sizes="50vw" width="10" height="5" loading="lazy"></picture>`);
    expect(out).toContain('srcset="a.webp 1x, b.webp 2x"');
    expect(out).toContain('sizes="50vw"');
    expect(out).toContain('width="10"');
    expect(out).toContain('loading="lazy"');
  });

  it("drops script URLs inside srcset", () => {
    const out = sanitizeHtml(`<img src="a.png" srcset="a.png 1x, javascript:alert(1) 2x">`);
    expect(out).not.toContain("javascript:");
    expect(out).toContain('srcset="a.png 1x"');
  });

  it("keeps inline SVG only with sanitize.svg", () => {
    const svg = `<svg viewBox="0 0 1 1"><circle r="1"></circle><script>alert(1)</script></svg>`;
    expect(sanitizeHtml(svg)).not.toContain("<svg");
    const kept = sanitizeHtml(svg, { svg: true });
    expect(kept).toContain("<svg");
    expect(kept).toContain("<circle");
    expect(kept).not.toContain("<script");
  });
});

describe("rehypeImages in the pipelines", () => {
  it("renders Markdown images from URLs and base64, measured and lazy", async () => {
    const r = await renderMarkdown(`![Remote](https://cdn.example/a.png)\n\nInline ![dot](${PNG_1x1}) icon.`, { images: quiet });
    expect(r.html).toMatch(
      /^<p data-block-id="p-[0-9a-f]{6}"><img src="https:\/\/cdn\.example\/a\.png" alt="Remote" loading="lazy" decoding="async" data-zr-image="block" data-zr-zoom="" tabindex="0" aria-haspopup="dialog"><\/p>/,
    );
    expect(r.html).toMatch(/<img src="data:image\/png;base64,[^"]+" alt="dot" width="1" height="1" loading="lazy" decoding="async" data-zr-image="inline">/);
  });

  it("drops images over maxDataUriBytes with a warning", async () => {
    const warnings: string[] = [];
    const r = await renderMarkdown(`![big](${PNG_1x1})`, { images: { images: { maxDataUriBytes: 10 }, warn: (m) => warnings.push(m), source: "ch.md" } });
    expect(r.html).not.toContain("<img");
    expect(warnings[0]).toMatch(/^ch\.md: dropped image \(inline image is 68 B, over content\.images\.maxDataUriBytes/);
  });

  it("enforces maxDataUriTotalBytes per chapter", async () => {
    const warnings: string[] = [];
    const r = await renderMarkdown(`![a](${PNG_1x1}) ![b](${PNG_1x1})`, { images: { images: { maxDataUriTotalBytes: 100 }, warn: (m) => warnings.push(m) } });
    expect(r.html.match(/<img/g)).toHaveLength(1);
    expect(warnings[0]).toMatch(/maxDataUriTotalBytes/);
  });

  it("drops disallowed remote hosts", async () => {
    const r = await renderHtml(`<p><img src="https://evil.dev/x.png" alt="x"></p><p><img src="https://ok.dev/y.png"></p>`, {
      images: { images: { allowRemote: ["ok.dev"] }, ...quiet },
    });
    expect(r.html).not.toContain("evil.dev");
    expect(r.html).toContain("ok.dev");
  });

  it("turns a titled lone image into a figure with a caption", async () => {
    const r = await renderMarkdown(`![Alt](/a.png "The caption")`, { images: quiet });
    expect(r.html).toMatch(/^<figure><img src="\/a\.png" alt="Alt"[^>]*><figcaption data-block-id="figcaption-[0-9a-f]{6}">The caption<\/figcaption><\/figure>$/);
    expect(r.html).not.toContain("title=");
  });

  it("measures root-relative images from the public folder", async () => {
    const pub = mkdtempSync(join(tmpdir(), "zr-pub-"));
    mkdirSync(join(pub, "img"));
    writeFileSync(join(pub, "img", "a.png"), pngOf(640, 480));
    const r = await renderMarkdown(`![a](/img/a.png) ![b](/../etc/x.png)`, { images: { publicDir: pub, ...quiet } });
    expect(r.html).toContain('src="/img/a.png" alt="a" width="640" height="480"');
  });

  it("keeps an author's width and fills the height from the aspect ratio", async () => {
    const pub = mkdtempSync(join(tmpdir(), "zr-pub-"));
    writeFileSync(join(pub, "a.png"), pngOf(400, 200));
    const r = await renderHtml(`<img src="/a.png" width="100">`, { images: { publicDir: pub, ...quiet } });
    expect(r.html).toContain('width="100" height="50"');
  });

  it("runs on .html chapters and MDX", async () => {
    const html = await renderHtml(`<p><img src="${PNG_1x1}"></p>`, { images: quiet });
    expect(html.html).toContain('width="1" height="1"');
    const mdx = await compileMdx(`![x](${PNG_1x1})`, { images: quiet });
    expect(mdx.code).toContain('"data-zr-image": "block"');
  });

  it("validates content.images in reader.config", () => {
    expect(() => resolveConfig({ content: { images: { maxDataUriBytes: -1 } } })).toThrow(/content\.images\.maxDataUriBytes/);
    const c = resolveConfig({ content: { images: { maxDataUriBytes: 1024 } } });
    expect(c.content.images).toMatchObject({ maxDataUriBytes: 1024, probeRemote: false, allowRemote: true });
  });
});

describe("image blocks (bookmarks, progress)", () => {
  it("ids image-only paragraphs and caption-less figures by alt or file name", async () => {
    const r = await renderHtml(`<p><img src="/x/diagram.png?v=2"></p><p><img src="/a.png" alt="A cat"></p><figure><img src="/b.png"></figure><figure><img src="/c.png"><figcaption>Cap</figcaption></figure>`, {
      images: quiet,
    });
    expect(r.blocks.map((b) => [b.tag, b.excerpt])).toEqual([
      ["p", "Image: diagram.png"],
      ["p", "Image: A cat"],
      ["figure", "Image: b.png"],
      ["figcaption", "Cap"],
    ]);
    expect(r.html).toMatch(/<figure><img src="\/c\.png"[^>]*><figcaption data-block-id=/);
  });

  it("matches the ids the browser assigns", async () => {
    const { ensureBlockIds } = await import("../src/core/dom");
    const html = `<p><img src="/x/diagram.png"></p><p><img alt="A cat" src="/a.png"></p><figure><img src="/b.png"></figure><p>Text</p>`;
    const server = await renderHtml(html, { images: false });
    const doc = new DOMParser().parseFromString(`<article>${html}</article>`, "text/html");
    ensureBlockIds(doc.body.firstElementChild!);
    const client = Array.from(doc.querySelectorAll("[data-block-id]")).map((e) => e.getAttribute("data-block-id"));
    expect(client).toEqual(server.blocks.map((b) => b.id));
  });
});
