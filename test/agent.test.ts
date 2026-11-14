import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defineBooks } from "../src/content/index";
import { resolveConfig } from "../src/config/index";
import {
  bookToMarkdown,
  createAgentHandler,
  htmlToMarkdown,
  llmsTxt,
  markdownPageUrl,
  matchAgentRoute,
  mdxToMarkdown,
  requestOrigin,
  shelfToMarkdown,
} from "../src/agent/index";

const ORIGIN = "https://press.example.com";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "zr-agent-"));
  const book = join(root, "content/books/context-infra");
  mkdirSync(book, { recursive: true });
  writeFileSync(join(book, "book.json"), JSON.stringify({ title: "Context Infrastructure", subtitle: "Build AI", authors: ["A. Writer"], description: "A book." }));
  writeFileSync(join(book, "01-intro.md"), "---\ntitle: Introduction\ndescription: Start here.\n---\n\nHello **world**.\n\n```sh\n# not a heading\n```\n");
  writeFileSync(
    join(book, "02-guide.mdx"),
    '---\ntitle: Guide\npart: Part I\n---\n\nimport X from "./x"\nexport const meta = 1\n\n## Setup\n\n<Callout title="Note">\n  Be **careful**.\n</Callout>\n\nValue: {1 + 1} done.\n\n<Widget />\n',
  );
  writeFileSync(
    join(book, "03-appendix-a-api.html"),
    "---\ntitle: API Reference\nlabel: Appendix A\n---\n<h1>API Reference</h1><table><thead><tr><th>Method</th><th>Path</th></tr></thead><tbody><tr><td>GET</td><td>/v1</td></tr></tbody></table><script>alert(1)</script><pre><code class=\"language-js\">fetch()</code></pre>",
  );
  const api = defineBooks(resolveConfig({ content: { cacheDir: join(root, ".cache") } }, null, { root }));
  writeFileSync(join(book, "04-whitepaper.pdf"), "%PDF-1.4 fake");
  return api;
}

describe("markdown conversion", () => {
  it("strips MDX imports, exports and expressions, unwraps JSX", async () => {
    const md = await mdxToMarkdown('import A from "a"\n\n# T\n\n<Callout title="Hi">\n  Text.\n</Callout>\n\n<Foo>kept</Foo>\n\nx {1} y');
    expect(md).not.toMatch(/import|Callout|Foo|\{1\}/);
    expect(md).toContain("> **Hi**");
    expect(md).toContain("> Text.");
    expect(md).toContain("kept");
  });

  it("treats a one-line JSX paragraph as a block and tidies dropped expressions", async () => {
    const md = await mdxToMarkdown('<Callout title="Note">Auth required.</Callout>\n\nValue {v}. a {x} b');
    expect(md).toContain("> **Note**\n>\n> Auth required.");
    expect(md).toContain("Value. a b");
  });

  it("keeps embedded files (PDFs) as links and line breaks as breaks", async () => {
    expect(await mdxToMarkdown('See <embed src="/files/white%20paper.pdf" type="application/pdf" />')).toBe(
      "See [white paper.pdf](/files/white%20paper.pdf)\n",
    );
    expect(await mdxToMarkdown('<iframe src="/a.pdf" title="The spec" />')).toBe("[The spec](/a.pdf)\n");
    expect(await mdxToMarkdown("One<br/>two")).toBe("One\\\ntwo\n");
    expect(await mdxToMarkdown("Before <Badge /> after.\n\n<Chart data={[1]} />\n\nEnd.")).toBe("Before after.\n\nEnd.\n");
    const html = await htmlToMarkdown('<p>See</p><embed src="/a.pdf"><iframe src="/b.pdf" title="B"></iframe><object data="/c.pdf">Fallback</object>');
    expect(html).toContain("[a.pdf](/a.pdf)");
    expect(html).toContain("[B](/b.pdf)");
    expect(html).toContain("[c.pdf](/c.pdf)");
  });

  it("serves the raw source when MDX can't be parsed", async () => {
    const { chapterBodyToMarkdown } = await import("../src/agent/index");
    const body = "<!-- not valid in MDX -->\n\nText";
    expect(await chapterBodyToMarkdown({ file: "/x.mdx", mtimeMs: 1, format: "mdx", body })).toBe(body);
  });

  it("converts HTML to GFM, dropping scripts", async () => {
    const md = await htmlToMarkdown("<h2>T</h2><table><tr><th>a</th></tr><tr><td>b</td></tr></table><script>x()</script><pre><code class=\"language-js\">f()</code></pre>");
    expect(md).toContain("## T");
    expect(md).toMatch(/\| a \|/);
    expect(md).toContain("```js\nf()\n```");
    expect(md).not.toContain("x()");
  });

  it("builds URLs for any basePath", () => {
    expect(markdownPageUrl({ origin: ORIGIN, basePath: "/books" }, "b", "c d")).toBe(`${ORIGIN}/books/b/c%20d.md`);
    expect(markdownPageUrl({ origin: ORIGIN, basePath: "/books/" })).toBe(`${ORIGIN}/books.md`);
    expect(markdownPageUrl({ origin: ORIGIN, basePath: "/" })).toBe(`${ORIGIN}/index.md`);
  });

  it("renders book, shelf and llms.txt indexes", async () => {
    const api = fixture();
    const books = await api.getBooks();
    const ctx = { origin: ORIGIN, basePath: "/books" };
    const book = bookToMarkdown(books[0]!, ctx);
    expect(book).toContain("# Context Infrastructure");
    expect(book).toContain("### Part I");
    expect(book).toContain(`- [Introduction](${ORIGIN}/books/context-infra/intro.md): Start here.`);
    expect(book).toContain(`[Appendix A: API Reference](${ORIGIN}/books/context-infra/appendix-a-api.md)`);
    expect(shelfToMarkdown(books, ctx)).toContain(`## [Context Infrastructure](${ORIGIN}/books/context-infra.md)`);
    const llms = llmsTxt(books, ctx);
    expect(llms.startsWith("# Context Infrastructure\n\n> A book.")).toBe(true);
    expect(llms).toContain(`- [Guide](${ORIGIN}/books/context-infra/guide.md)`);
  });
});

describe("matchAgentRoute", () => {
  it("matches only agent routes", () => {
    expect(matchAgentRoute("/books.md", "/books")).toEqual({ kind: "shelf" });
    expect(matchAgentRoute("/books/b.md", "/books")).toEqual({ kind: "book", book: "b" });
    expect(matchAgentRoute("/books/b/c%20d.md", "/books")).toEqual({ kind: "chapter", book: "b", chapter: "c d" });
    expect(matchAgentRoute("/llms.txt", "/books")).toEqual({ kind: "llms" });
    expect(matchAgentRoute("/llms.txt", "/books", false)).toBeNull();
    expect(matchAgentRoute("/books/b/c", "/books")).toBeNull();
    expect(matchAgentRoute("/books/b/c/d.md", "/books")).toBeNull();
    expect(matchAgentRoute("/other/b.md", "/books")).toBeNull();
    expect(matchAgentRoute("/books/%E0%A4%A.md", "/books")).toBeNull();
  });
});

describe("requestOrigin", () => {
  it("prefers forwarded headers and ignores junk", () => {
    const req = (headers: Record<string, string>) => new Request("http://0.0.0.0:3000/x", { headers });
    expect(requestOrigin(req({}))).toBe("http://0.0.0.0:3000");
    expect(requestOrigin(req({ "x-forwarded-host": "press.example.com, inner", "x-forwarded-proto": "https" }))).toBe("https://press.example.com");
    expect(requestOrigin(req({ "x-forwarded-host": "localhost:3000" }))).toBe("http://localhost:3000");
    expect(requestOrigin(req({ "x-forwarded-host": "evil.com/path?" }))).toBe("http://0.0.0.0:3000");
  });
});

describe("createAgentHandler", () => {
  const api = fixture();
  const handler = createAgentHandler({ api, basePath: "/books" });
  const get = (path: string, init?: RequestInit) => handler(new Request(`${ORIGIN}${path}`, init));

  it("serves a Markdown chapter with nav links and headers", async () => {
    const res = (await get("/books/context-infra/intro.md"))!;
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(res.headers.get("link")).toBe(`<${ORIGIN}/books/context-infra/intro>; rel="canonical"`);
    const body = await res.text();
    expect(body.startsWith("# Introduction\n\nHello **world**.")).toBe(true);
    expect(body).toContain("# not a heading");
    expect(body).toContain(`- Next: [Guide](${ORIGIN}/books/context-infra/guide.md)`);
    expect(body).toContain(`- Contents: [Context Infrastructure](${ORIGIN}/books/context-infra.md)`);
  });

  it("cleans MDX chapters", async () => {
    const body = await (await get("/books/context-infra/guide.md"))!.text();
    expect(body).toContain("# Guide");
    expect(body).toContain("## Setup");
    expect(body).toContain("> **Note**");
    expect(body).not.toMatch(/import|export|Widget|\{1 \+ 1\}/);
    expect(body).toContain("- Previous: [Introduction]");
  });

  it("does not duplicate an existing H1 (HTML chapter)", async () => {
    const body = await (await get("/books/context-infra/appendix-a-api.md"))!.text();
    expect(body.match(/^# /gm)).toHaveLength(1);
    expect(body).toContain("| GET");
    expect(body).not.toContain("alert");
  });

  it("serves the book, shelf and llms.txt", async () => {
    expect(await (await get("/books/context-infra.md"))!.text()).toContain("## Contents");
    expect(await (await get("/books.md"))!.text()).toContain("# Books");
    const llms = (await get("/llms.txt"))!;
    expect(llms.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await llms.text()).toContain("## Context Infrastructure");
  });

  it("404s unknown books and chapters as Markdown", async () => {
    expect((await api.getBooks())[0]!.chapters.map((c) => c.id)).not.toContain("whitepaper"); // PDFs aren't chapters
    expect((await get("/books/context-infra/whitepaper.md"))!.status).toBe(404);
    const res = (await get("/books/context-infra/nope.md"))!;
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("# Not found");
    expect((await get("/books/nope.md"))!.status).toBe(404);
  });

  it("ignores other requests", async () => {
    expect(await get("/books/context-infra/intro")).toBeUndefined();
    expect(await get("/about.md")).toBeUndefined();
    expect(await get("/books/context-infra/intro.md", { method: "POST" })).toBeUndefined();
  });

  it("answers HEAD without a body", async () => {
    const res = (await get("/books/context-infra/intro.md", { method: "HEAD" }))!;
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });

  it("honours a custom basePath, origin and llms options", async () => {
    const h2 = createAgentHandler({ api, basePath: "/read", origin: "https://cdn.example.com/", llms: { title: "Press" } });
    const res = (await h2(new Request("http://localhost/read/context-infra/intro.md")))!;
    expect(await res.text()).toContain("https://cdn.example.com/read/context-infra/guide.md");
    expect(await h2(new Request("http://localhost/books/context-infra/intro.md"))).toBeUndefined();
    expect(await (await h2(new Request("http://localhost/llms.txt")))!.text()).toMatch(/^# Press/);
    const off = createAgentHandler({ api, basePath: "/books", llms: false });
    expect(await off(new Request("http://localhost/llms.txt"))).toBeUndefined();
  });
});
