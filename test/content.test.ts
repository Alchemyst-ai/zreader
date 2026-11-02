import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { compileMdx, defineBooks, renderHtml, renderMarkdown, runMdx, sanitizeHtml } from "../src/content/index";
import { resolveConfig } from "../src/config/index";

describe("sanitizeHtml", () => {
  const vectors = [
    `<img src=x onerror=alert(1)>`,
    `<script>alert(1)</script>`,
    `<a href="javascript:alert(1)">x</a>`,
    `<svg><script>alert(1)</script></svg>`,
    `<iframe src="https://evil.example/x"></iframe>`,
    `<div style="background:url(javascript:alert(1))">x</div>`,
    `<form action="https://evil.example"><input name=a></form>`,
    `<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>`,
    `<a href="  JaVaScRiPt:alert(1)">x</a>`,
    `<object data="x.swf"></object><embed src="x.swf">`,
  ];
  it.each(vectors)("neutralises %s", (input) => {
    const out = sanitizeHtml(input);
    expect(out).not.toMatch(/<script|onerror|javascript:|<iframe|style=|<form|<object|<embed|<input/i);
  });

  it("keeps allow-listed iframes, sandboxed", () => {
    const out = sanitizeHtml(`<iframe src="https://www.youtube.com/embed/x"></iframe>`, { allowIframes: ["youtube.com"] });
    expect(out).toContain("<iframe");
    expect(out).toContain("sandbox=");
  });

  it("keeps GFM checkboxes (disabled) but drops other inputs", () => {
    const out = sanitizeHtml(`<input type="checkbox" checked onclick="x()"><input type="text" value="x"><input type="hidden" name="a">`);
    expect(out).toBe(`<input type="checkbox" checked="" disabled="">`);
  });

  it("adds rel=noopener to target=_blank links", () => {
    expect(sanitizeHtml(`<a href="https://x.dev" target="_blank">x</a>`)).toContain('rel="noopener noreferrer"');
  });
});

describe("renderMarkdown / renderHtml", () => {
  it("adds block ids, heading ids, toc and a content hash", async () => {
    const r = await renderMarkdown("# Title\n\n## First part\n\nHello **world**.\n\n- one\n- two\n\n## First part\n\nAgain.");
    expect(r.html).toMatch(/<h2 id="first-part" data-block-id="h2-[0-9a-f]{6}">/);
    expect(r.html).toContain('id="first-part-1"');
    expect(r.html).toMatch(/<p data-block-id="p-[0-9a-f]{6}">Hello/);
    expect(r.html).toMatch(/<li data-block-id="li-/);
    expect(r.toc).toEqual([
      { id: "first-part", depth: 2, text: "First part" },
      { id: "first-part-1", depth: 2, text: "First part" },
    ]);
    expect(r.contentHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("sanitizes inline HTML in markdown", async () => {
    const r = await renderMarkdown("Hi <img src=x onerror=alert(1)> <script>alert(1)</script>");
    expect(r.html).not.toMatch(/onerror|<script/);
  });

  it("only ids the innermost block and dedupes identical blocks", async () => {
    const r = await renderHtml("<blockquote><p>Same</p></blockquote><p>Same</p>");
    expect(r.html).toMatch(/<blockquote><p data-block-id="(p-[0-9a-f]{6})">Same<\/p><\/blockquote><p data-block-id="\1-2">/);
  });

  it("strips author-supplied block ids", async () => {
    const r = await renderHtml(`<p data-block-id="evil">x</p>`);
    expect(r.html).not.toContain("evil");
  });
});

describe("MDX", () => {
  it("compiles, runs and annotates trusted MDX", async () => {
    const c = await compileMdx("## Hi\n\nSome <Callout>text</Callout> here.\n\nexport const x = 1");
    expect(c.toc[0]).toMatchObject({ id: "hi", text: "Hi" });
    const Content = await runMdx(c.code);
    const html = renderToStaticMarkup(
      createElement(Content, { components: { Callout: ({ children }: { children?: unknown }) => createElement("mark", null, children as never) } }),
    );
    expect(html).toContain('<h2 id="hi" data-block-id="h2-');
    expect(html).toContain("<mark>text</mark>");
  });
});

describe("content loader", () => {
  function fixture() {
    const root = mkdtempSync(join(tmpdir(), "zr-"));
    const book = join(root, "content/books/field-guide");
    mkdirSync(book, { recursive: true });
    writeFileSync(join(book, "book.json"), JSON.stringify({ title: "Field Guide", authors: ["A. Writer"] }));
    writeFileSync(join(book, "02-second.md"), "---\ntitle: Second\n---\n\nTwo.");
    writeFileSync(join(book, "01-first.mdx"), "---\ntitle: First\n---\n\n## Start\n\nOne.");
    writeFileSync(join(book, "03-draft.html"), "---\ntitle: Draft\ndraft: true\n---\n<p>wip</p>");
    return root;
  }

  it("loads books, orders chapters, hides drafts and renders each format", async () => {
    const root = fixture();
    const api = defineBooks(resolveConfig({ content: { includeDrafts: false, cacheDir: join(root, ".cache") } }, null, { root }));
    const [book] = await api.getBooks();
    expect(book).toMatchObject({ id: "field-guide", title: "Field Guide", authors: ["A. Writer"] });
    expect(book!.chapters.map((c) => c.id)).toEqual(["first", "second"]);

    const hit = await api.getChapter("field-guide", "first");
    expect(hit?.next?.id).toBe("second");
    const rendered = await api.renderChapter(hit!.chapter);
    expect(rendered.kind).toBe("mdx");
    expect(rendered.toc[0]?.id).toBe("start");

    const md = await api.renderChapter((await api.getChapter("field-guide", "second"))!.chapter);
    expect(md.kind === "html" && md.html).toMatch(/<p data-block-id="p-[0-9a-f]{6}">Two\.<\/p>/);

    expect(await api.getStaticParams()).toEqual([
      { book: "field-guide", chapter: "first" },
      { book: "field-guide", chapter: "second" },
    ]);
  });

  it("reports invalid frontmatter with the file path", async () => {
    const root = fixture();
    writeFileSync(join(root, "content/books/field-guide/04-bad.md"), "---\norder: 4\n---\nno title");
    const api = defineBooks(resolveConfig({ content: { cacheDir: join(root, ".cache") } }, null, { root }));
    await expect(api.getBooks()).rejects.toThrow(/Invalid chapter frontmatter[\s\S]*title[\s\S]*04-bad\.md/);
  });
});
