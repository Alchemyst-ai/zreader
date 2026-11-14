import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineBooks } from "../src/content/index";
import { glob, resolveConfig, type ReaderUserConfig } from "../src/config/index";
import type { AgentPlugin } from "../src/plugins/agent/types";
import {
  bookToMarkdown,
  chapterBodyToMarkdown,
  createAgentHandler,
  demoteHeadings,
  fullTextToMarkdown,
  htmlToMarkdown,
  llmsTxt,
  markdownPageUrl,
  matchAgentRoute,
  mdxToMarkdown,
  renderFrontmatter,
  requestOrigin,
  resolveLastUpdated,
  shelfToMarkdown,
  type AgentHandlerOptions,
} from "../src/agent/index";
import { cors, disable, frontmatter, llmsTxt as llmsTxtPlugin, mcp, notFound } from "../src/plugins/agent/index";

const ORIGIN = "https://press.example.com";

function book(dir: string, meta: Record<string, unknown>, chapters: Array<[string, string]>) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "book.json"), JSON.stringify(meta));
  for (const [name, body] of chapters) writeFileSync(join(dir, name), body);
}

/** Two content folders, one per shelf. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "zr-agent-"));
  book(
    join(root, "content/books/context-infra"),
    { title: "Context Infrastructure", subtitle: "Build AI", authors: ["A. Writer"], description: "A book." },
    [
      [
        "01-intro.md",
        "---\ntitle: Introduction\ndescription: Start here.\nupdated: 2026-11-02\n---\n\nHello **world**.\n\n```sh\n# not a heading\n```\n",
      ],
      [
        "02-guide.mdx",
        '---\ntitle: Guide\npart: Part I\nupdated: 2026-10-01\n---\n\nimport X from "./x"\nexport const meta = 1\n\n## Setup\n\n<Callout title="Note">\n  Be **careful**.\n</Callout>\n\nValue: {1 + 1} done.\n\n<Widget />\n',
      ],
      [
        "03-appendix-a-api.html",
        '---\ntitle: API Reference\nlabel: Appendix A\nupdated: 2026-01-05\n---\n<h1>API Reference</h1><table><thead><tr><th>Method</th><th>Path</th></tr></thead><tbody><tr><td>GET</td><td>/v1</td></tr></tbody></table><script>alert(1)</script><pre><code class="language-js">fetch()</code></pre>',
      ],
      ["04-whitepaper.pdf", "%PDF-1.4 fake"],
    ],
  );
  book(
    join(root, "content/reports/q3-2026"),
    { title: "Q3 2026", description: "Results and commentary for the third quarter." },
    [
      ["01-revenue.md", "---\ntitle: Revenue\nupdated: 2026-11-09\n---\n\n## Revenue\n\nUp 12%.\n"],
      ["02-costs.md", "---\ntitle: Costs\nupdated: 2026-11-10\n---\n\nCosts were flat.\n"],
    ],
  );
  return root;
}

/** One handler serving every shelf of `user`, backed by the fixture folders. */
function handlerFor(user: ReaderUserConfig, options: AgentHandlerOptions = {}) {
  const root = fixture();
  const config = resolveConfig(user, null, { root });
  const sources = config.shelves.map((shelf) => ({
    shelf,
    api: defineBooks(resolveConfig({ content: shelf.content }, null, { root })),
  }));
  return createAgentHandler({ sources, origin: ORIGIN, ...options });
}

function twoShelves(agent: Record<string, AgentPlugin[]> = {}): ReaderUserConfig {
  return {
    bookshelves: [
      {
        id: "books",
        basePath: "/books",
        content: { loader: glob({ base: "./content/books" }) },
        ...(agent.books ? { agent: { plugins: agent.books } } : {}),
      },
      {
        id: "reports",
        basePath: "/reports",
        title: "Quarterly reports",
        content: { loader: glob({ base: "./content/reports" }) },
        ...(agent.reports ? { agent: { plugins: agent.reports } } : {}),
      },
    ],
  };
}

const get = (handler: ReturnType<typeof handlerFor>, path: string, init?: RequestInit) =>
  handler(new Request(`${ORIGIN}${path}`, init));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// ------------------------------------------------------------------ conversion

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
    const html = await htmlToMarkdown('<p>See</p><embed src="/a.pdf"><object data="/c.pdf">Fallback</object>');
    expect(html).toContain("[a.pdf](/a.pdf)");
    expect(html).toContain("[c.pdf](/c.pdf)");
  });

  it("serves the raw source when MDX can't be parsed", async () => {
    const body = "<!-- not valid in MDX -->\n\nText";
    expect(await chapterBodyToMarkdown({ file: "/x.mdx", mtimeMs: 1, format: "mdx", body })).toBe(body);
  });

  it("converts HTML to GFM, dropping scripts", async () => {
    const md = await htmlToMarkdown("<h2>T</h2><table><tr><th>a</th></tr><tr><td>b</td></tr></table><script>x()</script>");
    expect(md).toContain("## T");
    expect(md).toMatch(/\| a \|/);
    expect(md).not.toContain("x()");
  });

  it("builds URLs for any basePath", () => {
    expect(markdownPageUrl({ origin: ORIGIN, basePath: "/books" }, "b", "c d")).toBe(`${ORIGIN}/books/b/c%20d.md`);
    expect(markdownPageUrl({ origin: ORIGIN, basePath: "/books/" })).toBe(`${ORIGIN}/books.md`);
    expect(markdownPageUrl({ origin: ORIGIN, basePath: "/" })).toBe(`${ORIGIN}/index.md`);
  });

  it("demotes headings on the mdast, clamped at 6, ignoring fenced code", async () => {
    const src = "# One\n\n## Two\n\n```sh\n# not a heading\n```\n";
    const out = await demoteHeadings(src, 2);
    expect(out).toContain("### One");
    expect(out).toContain("#### Two");
    expect(out).toContain("# not a heading");
    expect(await demoteHeadings("###### Deep\n", 2)).toContain("###### Deep");
  });

  it("renders book, shelf and llms.txt indexes with a shelf title", async () => {
    const api = defineBooks(resolveConfig({ content: { loader: glob({ base: "./content/books" }) } }, null, { root: fixture() }));
    const books = await api.getBooks();
    const ctx = { origin: ORIGIN, basePath: "/books" };
    expect(bookToMarkdown(books[0]!, ctx)).toContain(`- [Introduction](${ORIGIN}/books/context-infra/intro.md): Start here.`);
    expect(shelfToMarkdown(books, ctx)).toContain(`## [Context Infrastructure](${ORIGIN}/books/context-infra.md)`);
    expect(shelfToMarkdown(books, ctx, { title: "Quarterly reports", description: "Every report." })).toContain(
      "# Quarterly reports\n\n> Every report.",
    );
    const llms = llmsTxt(books, ctx);
    expect(llms.startsWith("# Context Infrastructure\n\n> A book.")).toBe(true);
    expect(llms).toContain(`- [Guide](${ORIGIN}/books/context-infra/guide.md)`);
  });
});

describe("renderFrontmatter", () => {
  it("quotes every value as JSON and omits empties", () => {
    expect(renderFrontmatter({ title: 'A "quoted" title', description: undefined, canonical: "" })).toBe(
      '---\ntitle: "A \\"quoted\\" title"\n---\n\n',
    );
    expect(renderFrontmatter({})).toBe("");
    expect(renderFrontmatter({ description: "  spaced \n out " })).toBe('---\ndescription: "spaced out"\n---\n\n');
  });

  it("keeps insertion order and rejects bad keys", () => {
    expect(renderFrontmatter({ title: "T", last_updated: "2026-11-02" })).toBe(
      '---\ntitle: "T"\nlast_updated: "2026-11-02"\n---\n\n',
    );
    expect(() => renderFrontmatter({ "bad key": "x" })).toThrow(/not a valid frontmatter key/);
  });
});

describe("resolveLastUpdated", () => {
  const entry = (data: Record<string, unknown>, mtimeMs: number) =>
    ({ file: "/x.md", mtimeMs, data, body: "", format: "md" }) as never;

  it("prefers the override, then frontmatter, then mtime; skips invalid dates", () => {
    expect(resolveLastUpdated(entry({ updated: "2026-11-02" }, Date.parse("2026-01-01")))).toBe("2026-11-02");
    expect(resolveLastUpdated(entry({ last_updated: "2026-05-06" }, 1))).toBe("2026-05-06");
    expect(resolveLastUpdated(entry({ date: "2026-03-04" }, 1))).toBe("2026-03-04");
    expect(resolveLastUpdated(entry({}, Date.parse("2026-02-03T12:00:00Z")))).toBe("2026-02-03");
    expect(resolveLastUpdated(entry({ updated: "yesterday" }, Date.parse("2026-02-03")))).toBe("2026-02-03");
    expect(resolveLastUpdated(entry({ updated: "nope" }, NaN))).toBeUndefined();
    expect(resolveLastUpdated(entry({}, 1), () => "2026-12-31")).toBe("2026-12-31");
  });
});

// ------------------------------------------------------------------ matching

describe("matchAgentRoute", () => {
  it("matches only the core routes", () => {
    expect(matchAgentRoute("/books.md", "/books")).toEqual({ kind: "shelf" });
    expect(matchAgentRoute("/books/b.md", "/books")).toEqual({ kind: "book", book: "b" });
    expect(matchAgentRoute("/books/b/c%20d.md", "/books")).toEqual({ kind: "chapter", book: "b", chapter: "c d" });
    expect(matchAgentRoute("/llms.txt", "/books")).toBeNull();
    expect(matchAgentRoute("/books/b/c", "/books")).toBeNull();
    expect(matchAgentRoute("/books/b/c/d.md", "/books")).toBeNull();
    expect(matchAgentRoute("/other/b.md", "/books")).toBeNull();
    expect(matchAgentRoute("/books/%E0%A4%A.md", "/books")).toBeNull();
    expect(matchAgentRoute("/index.md", "/")).toEqual({ kind: "shelf" });
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

// ------------------------------------------------------------------ core handler

describe("createAgentHandler — core", () => {
  const handler = handlerFor(twoShelves());

  it("serves each shelf's books, with no cross-talk", async () => {
    const books = await (await get(handler, "/books.md"))!.text();
    expect(books).toContain("# Books");
    expect(books).toContain("Context Infrastructure");
    expect(books).not.toContain("Q3 2026");
    const reportsShelf = await (await get(handler, "/reports.md"))!.text();
    expect(reportsShelf).toContain("# Quarterly reports");
    expect(reportsShelf).toContain("Q3 2026");
    expect(reportsShelf).not.toContain("Context Infrastructure");
    expect(await (await get(handler, "/reports/q3-2026/revenue.md"))!.text()).toContain("Up 12%");
    // The reports shelf owns everything under /reports, so its own 404 answers.
    const cross = (await get(handler, "/reports/context-infra/intro.md"))!;
    expect(cross.status).toBe(404);
    expect(await cross.text()).toContain("No book at `/reports/context-infra/intro.md`");
    // The books shelf owns everything under /books, so its own 404 answers.
    expect((await get(handler, "/books/q3-2026/revenue.md"))!.status).toBe(404);
  });

  it("serves one shelf only when asked", async () => {
    const only = handlerFor(twoShelves(), { shelves: ["reports"] });
    expect(await get(only, "/reports.md")).toBeDefined();
    expect(await get(only, "/books.md")).toBeUndefined();
  });

  it("has no /llms.txt route without the plugin", async () => {
    expect(await get(handler, "/llms.txt")).toBeUndefined();
    expect(await get(handler, "/books/llms.txt")).toBeUndefined();
  });

  it("keeps the 0.2 bodies byte-identical with no bookshelves and no plugins", async () => {
    const root = fixture();
    const legacy = createAgentHandler({
      origin: ORIGIN,
      sources: [
        {
          shelf: {
            id: "books",
            basePath: "/books",
            title: "Books",
            content: resolveConfig({ content: { loader: glob({ base: "./content/books" }) } }, null, { root }).content,
            reader: resolveConfig({}, null, { root }).reader,
            plugins: [],
          },
          api: defineBooks(resolveConfig({ content: { loader: glob({ base: "./content/books" }) } }, null, { root })),
        },
      ],
    });
    expect(await (await legacy(new Request(`${ORIGIN}/books.md`)))!.text()).toBe(
      `# Books\n\n## [Context Infrastructure](${ORIGIN}/books/context-infra.md)\n\n_Build AI_\n\nBy A. Writer\n\nA book.\n`,
    );
    expect(await (await legacy(new Request(`${ORIGIN}/books/context-infra.md`)))!.text()).toBe(
      `# Context Infrastructure\n\n_Build AI_\n\nBy A. Writer\n\nA book.\n\n` +
        `## Contents\n\n- [Introduction](${ORIGIN}/books/context-infra/intro.md): Start here.\n\n` +
        `### Part I\n\n- [Guide](${ORIGIN}/books/context-infra/guide.md)\n` +
        `- [Appendix A: API Reference](${ORIGIN}/books/context-infra/appendix-a-api.md)\n\n` +
        `---\n\n- All books: [Shelf](${ORIGIN}/books.md)\n`,
    );
    expect(await (await legacy(new Request(`${ORIGIN}/books/context-infra/intro.md`)))!.text()).toBe(
      `# Introduction\n\nHello **world**.\n\n\`\`\`sh\n# not a heading\n\`\`\`\n\n---\n\n` +
        `- Contents: [Context Infrastructure](${ORIGIN}/books/context-infra.md)\n` +
        `- Next: [Guide](${ORIGIN}/books/context-infra/guide.md)\n`,
    );
    const missing = await legacy(new Request(`${ORIGIN}/books/context-infra/nope.md`));
    expect(missing!.status).toBe(404);
    expect(missing!.headers.get("cache-control")).toBe("no-store");
    expect(await missing!.text()).toBe(
      `# Not found\n\nNo chapter at \`/books/context-infra/nope.md\`. See the [shelf](${ORIGIN}/books.md).\n`,
    );
  });

  it("cleans MDX chapters and does not duplicate an existing H1", async () => {
    const body = await (await get(handler, "/books/context-infra/guide.md"))!.text();
    expect(body).toContain("# Guide");
    expect(body).toContain("## Setup");
    expect(body).toContain("> **Note**");
    expect(body).not.toMatch(/import|export|Widget|\{1 \+ 1\}/);
    const html = await (await get(handler, "/books/context-infra/appendix-a-api.md"))!.text();
    expect(html.match(/^# /gm)).toHaveLength(1);
    expect(html).not.toContain("alert");
  });

  it("sends the core headers and answers HEAD without a body", async () => {
    const res = (await get(handler, "/books/context-infra/intro.md"))!;
    expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(res.headers.get("link")).toBe(`<${ORIGIN}/books/context-infra/intro>; rel="canonical"`);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const head = (await get(handler, "/books/context-infra/intro.md", { method: "HEAD" }))!;
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  it("ignores everything it does not own", async () => {
    expect(await get(handler, "/books/context-infra/intro")).toBeUndefined();
    expect(await get(handler, "/about.md")).toBeUndefined();
    expect(await get(handler, "/books/context-infra/intro.md", { method: "POST" })).toBeUndefined();
  });

  it("drops a plugin the shelf disables", async () => {
    const root = fixture();
    const config = resolveConfig(
      { agent: { plugins: [notFound(), frontmatter()] }, bookshelves: [{ id: "books", basePath: "/books", content: { loader: glob({ base: "./content/books" }) }, agent: { plugins: [disable("notFound")] } }] },
      null,
      { root },
    );
    expect(config.shelves[0]!.plugins.map((p) => p.name)).toEqual(["frontmatter"]);
  });
});

// ------------------------------------------------------------------ frontmatter

describe("frontmatter()", () => {
  const handler = handlerFor(twoShelves({ books: [frontmatter()] }));

  it("adds a block above the body for every document kind", async () => {
    const chapter = await (await get(handler, "/books/context-infra/intro.md"))!.text();
    expect(chapter.startsWith('---\ntitle: "Introduction — Context Infrastructure"\n')).toBe(true);
    expect(chapter).toContain('description: "Start here."');
    expect(chapter).toContain(`canonical: "${ORIGIN}/books/context-infra/intro"`);
    expect(chapter).toContain('last_updated: "2026-11-02"');
    expect(chapter).toContain('book: "Context Infrastructure"');
    // The block comes first, whatever the plugin order.
    expect(chapter.indexOf("---\n\n")).toBeLessThan(chapter.indexOf("\n# Introduction"));
    const book = await (await get(handler, "/books/context-infra.md"))!.text();
    expect(book).toMatch(/^---\ntitle: "Context Infrastructure"\ndescription: "Build AI"\n/);
    expect(book).not.toContain('label:');
    const shelf = await (await get(handler, "/books.md"))!.text();
    expect(shelf).toMatch(/^---\ntitle: "Books"\n/);
  });

  it("gives a chapter its label and a book the newest chapter date", async () => {
    const appendix = await (await get(handler, "/books/context-infra/appendix-a-api.md"))!.text();
    expect(appendix).toContain('label: "Appendix A"');
    const book = await (await get(handler, "/books/context-infra.md"))!.text();
    expect(book).toContain('last_updated: "2026-11-02"'); // newest of 2026-10-01 / 2026-11-02 / 2026-01-05
    const shelf = await (await get(handler, "/books.md"))!.text();
    expect(shelf).toContain('last_updated: "2026-11-02"');
  });

  it("gives 404s a title and description but no canonical", async () => {
    const res = (await get(handler, "/books/nope.md"))!;
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).toMatch(/^---\ntitle: "Not found"\ndescription: "No book at \/books\/nope\.md\."\n---\n\n/);
    expect(body).not.toContain("canonical");
  });

  it("honours the title, lastUpdated and extra options", async () => {
    const custom = handlerFor({
      bookshelves: [
        {
          id: "books",
          basePath: "/books",
          content: { loader: glob({ base: "./content/books" }) },
          agent: {
            plugins: [
              frontmatter({
                title: (doc) => `[${doc.meta.title}]`,
                lastUpdated: () => "2020-01-01",
                extra: () => ({ "9bad": "x", site: "Press" }),
              }),
            ],
          },
        },
      ],
    });
    const body = await (await get(custom, "/books/context-infra/intro.md"))!.text();
    expect(body).toContain('title: "[Introduction]"');
    expect(body).toContain('last_updated: "2020-01-01"');
    expect(body).toContain('site: "Press"');
    expect(body).not.toContain("9bad");
  });
});

// ------------------------------------------------------------------ llmsTxt

describe("llmsTxt()", () => {
  it("serves one shelf's index under its basePath", async () => {
    const handler = handlerFor(twoShelves({ books: [llmsTxtPlugin()], reports: [llmsTxtPlugin({ full: true })] }));
    const res = (await get(handler, "/books/llms.txt"))!;
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const body = await res.text();
    // A one-book shelf uses the book title; the reports shelf has its own.
    expect(body.startsWith("# Context Infrastructure\n")).toBe(true);
    expect(body).toContain("Context Infrastructure");
    expect(body).not.toContain("Q3 2026");
    expect(await get(handler, "/reports/llms.txt")).toBeDefined();
    expect(await get(handler, "/books/llms-full.txt")).toBeUndefined();
  });

  it("claims the site root with root: true", async () => {
    const handler = handlerFor(
      twoShelves({ books: [llmsTxtPlugin({ root: true })] }),
    );
    const body = await (await get(handler, "/llms.txt"))!.text();
    expect(body).toContain("Context Infrastructure");
    expect(body).not.toContain("Q3 2026");
    expect(await get(handler, "/llms-full.txt")).toBeUndefined();
  });

  it("rejects two shelves claiming /llms.txt", () => {
    const root = fixture();
    expect(() =>
      resolveConfig(
        { bookshelves: [
          { id: "a", basePath: "/a", content: { loader: glob({ base: "./content/books" }) }, agent: { plugins: [llmsTxtPlugin({ root: true })] } },
          { id: "b", basePath: "/b", content: { loader: glob({ base: "./content/reports" }) }, agent: { plugins: [llmsTxtPlugin({ root: true })] } },
        ] },
        null,
        { root },
      ),
    ).toThrow(/\/llms\.txt is already claimed by "a"/);
  });

  it("concatenates every chapter for llms-full.txt", async () => {
    const handler = handlerFor(twoShelves({ reports: [llmsTxtPlugin({ full: true })] }));
    const res = (await get(handler, "/reports/llms-full.txt"))!;
    expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    const body = await res.text();
    expect(body.startsWith("# Quarterly reports — full text\n\n> Every book and chapter in this shelf")).toBe(true);
    expect(body).toContain("## Q3 2026\n\nSource: https://press.example.com/reports/q3-2026");
    expect(body).toContain("### Revenue");
    // The chapter body has its own H2, demoted by two → H4.
    expect(body).toContain("#### Revenue");
    expect(body).toContain("### Costs");
    expect(body).toContain("Costs were flat.");
  });

  it("keeps a body H1 as the chapter heading and never touches fenced code", async () => {
    const handler = handlerFor(twoShelves({ books: [llmsTxtPlugin({ full: true })] }));
    const body = await (await get(handler, "/books/llms-full.txt"))!.text();
    expect(body).toContain("# Books — full text");
    // The HTML chapter's body has its own H1, demoted by two → the chapter's H3.
    // No synthetic `### API Reference` is emitted in front of it.
    expect(body).toContain("\n\n### API Reference\n");
    expect(body).not.toContain("### API Reference\n\n### API Reference");
    expect(body.match(/^# API/m)).toBeNull();
    // A chapter body without an H1 gets a synthetic H3 instead.
    expect(body).toContain("\n\n### Introduction\n");
    expect(body).toContain("# not a heading"); // inside a fenced block
  });

  it("memoises the assembled document and skips building it for HEAD", async () => {
    const handler = handlerFor(twoShelves({ reports: [llmsTxtPlugin({ full: true })] }));
    const first = await (await get(handler, "/reports/llms-full.txt"))!.text();
    const spy = vi.spyOn(await import("../src/agent/markdown"), "fullTextToMarkdown");
    const second = await (await get(handler, "/reports/llms-full.txt"))!.text();
    expect(second).toBe(first);
    expect(spy).not.toHaveBeenCalled();
    const head = (await get(handler, "/reports/llms-full.txt", { method: "HEAD" }))!;
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });
});

// ------------------------------------------------------------------ notFound

describe("notFound()", () => {
  const handler = handlerFor(twoShelves({ books: [notFound({ maxChapters: 1 })], reports: [notFound()] }));

  it("lists chapters and books for a missing chapter", async () => {
    const res = (await get(handler, "/books/context-infra/nope.md"))!;
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).toContain("# Not found");
    expect(body).toContain(`No chapter \`nope\` in [Context Infrastructure](${ORIGIN}/books/context-infra.md).`);
    expect(body).toContain("## Chapters in Context Infrastructure");
    expect(body).toContain(`- [Introduction](${ORIGIN}/books/context-infra/intro.md)`);
    expect(body).toContain("## All books");
    expect(body).toContain("— 3 chapters");
    expect(body).toContain(`See the [shelf](${ORIGIN}/books.md).`);
    // maxChapters: 1 → the rest are counted, not listed.
    expect(body).toContain("…and 2 more");
  });

  it("lists books only for a missing book, and only this shelf's", async () => {
    const body = await (await get(handler, "/books/nope.md"))!.text();
    expect(body).toContain(`No book \`nope\` in the [shelf](${ORIGIN}/books.md).`);
    expect(body).not.toContain("## Chapters in");
    expect(body).toContain("## All books");
    expect(body).toContain("Context Infrastructure");
    expect(body).not.toContain("Q3 2026");
  });

  it("only applies to paths the shelf owns", async () => {
    expect(await get(handler, "/other/nope.md")).toBeUndefined();
  });

  it("lets render replace the body", async () => {
    const custom = handlerFor(
      twoShelves({ books: [notFound({ render: (info) => `custom ${info.what}` })] }),
    );
    expect(await (await get(custom, "/books/nope.md"))!.text()).toBe("custom book");
  });
});

// ------------------------------------------------------------------ cors

describe("cors()", () => {
  const handler = handlerFor(twoShelves({ books: [cors()] }));

  it("allows any origin by default", async () => {
    const res = (await get(handler, "/books.md"))!;
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("vary")).toBeNull();
  });

  it("varies on Origin for a specific origin and joins extra Vary values", async () => {
    const custom = handlerFor(
      twoShelves({ books: [cors({ origin: "https://app.example.com", vary: ["Accept", "User-Agent"] })] }),
    );
    const res = (await get(custom, "/books.md"))!;
    expect(res.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
    expect(res.headers.get("vary")).toBe("Accept, User-Agent, Origin");
  });

  it("answers OPTIONS on every route of the shelf", async () => {
    const res = (await get(handler, "/books/context-infra/intro.md", { method: "OPTIONS" }))!;
    expect(res.status).toBe(204);
    expect(res.headers.get("allow")).toBe("GET, HEAD, OPTIONS");
    expect(res.headers.get("access-control-allow-methods")).toBe("GET, HEAD, OPTIONS");
    expect(res.headers.get("access-control-max-age")).toBe("86400");
    expect(res.headers.get("access-control-allow-headers")).toContain("Mcp-Session-Id");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("applies to plugin routes too", async () => {
    const withLlms = handlerFor(twoShelves({ books: [cors(), llmsTxtPlugin()] }));
    const res = (await get(withLlms, "/books/llms.txt"))!;
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const pre = (await get(withLlms, "/books/llms.txt", { method: "OPTIONS" }))!;
    expect(pre.status).toBe(204);
  });

  it("is scoped to the shelf that declares it", async () => {
    expect((await get(handler, "/reports.md"))!.headers.get("access-control-allow-origin")).toBeNull();
  });
});

// ------------------------------------------------------------------ mcp

describe("mcp()", () => {
  const handler = handlerFor(twoShelves({ reports: [mcp()] }));
  const post = (path: string, body: unknown) =>
    get(handler, path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const rpc = async (msg: unknown) => JSON.parse(await (await post("/reports/mcp", msg))!.text());

  it("does not answer GET (a book called mcp keeps its page)", async () => {
    expect(await get(handler, "/reports/mcp")).toBeUndefined();
  });

  it("initializes with a server name and a tools capability", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(res.result.serverInfo).toMatchObject({ name: "zreader-reports" });
    expect(res.result.capabilities).toEqual({ tools: { listChanged: false } });
    expect(res.result.protocolVersion).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("answers a notification with 202 and no body", async () => {
    const res = (await post("/reports/mcp", { jsonrpc: "2.0", method: "notifications/initialized" }))!;
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
  });

  it("lists the tools", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(res.result.tools.map((t: { name: string }) => t.name)).toEqual(["list_books", "get_book", "get_chapter", "search"]);
  });

  it("calls every tool", async () => {
    const list = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_books", arguments: {} } });
    const books = JSON.parse(list.result.content[0].text);
    expect(books[0]).toMatchObject({ id: "q3-2026", title: "Q3 2026" });
    expect(books[0].chapters.map((c: { id: string }) => c.id)).toEqual(["revenue", "costs"]);

    const book = await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_book", arguments: { book: "q3-2026" } } });
    expect(book.result.content[0].text).toContain("# Q3 2026");
    expect(book.result.content[0].text).toContain("## Contents");

    const chapter = await rpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "get_chapter", arguments: { book: "q3-2026", chapter: "revenue" } } });
    expect(chapter.result.content[0].text).toContain("Up 12%");

    const hits = JSON.parse(
      (await rpc({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "search", arguments: { query: "costs" } } })).result
        .content[0].text,
    );
    expect(hits[0]).toMatchObject({ book: "q3-2026", chapter: "costs" });
    expect(hits[0].snippet.length).toBeGreaterThan(0);
  });

  it("returns isError for unknown ids, with the notFound text when enabled", async () => {
    const withNotFound = handlerFor(twoShelves({ reports: [notFound(), mcp()] }));
    const res = await (async () => {
      const r = await withNotFound(
        new Request(`${ORIGIN}/reports/mcp`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "get_book", arguments: { book: "nope" } } }),
        }),
      );
      return JSON.parse(await r!.text());
    })();
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toContain("No book `nope`");
  });

  it("rejects unknown methods and tools, and malformed JSON", async () => {
    expect(await rpc({ jsonrpc: "2.0", id: 8, method: "nope" })).toMatchObject({ error: { code: -32601 } });
    expect(await rpc({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "nope" } })).toMatchObject({
      error: { code: -32602 },
    });
    const bad = (await get(handler, "/reports/mcp", { method: "POST", body: "{oops" }))!;
    expect(await bad.text()).toContain("-32700");
  });

  it("supports batches", async () => {
    const res = (await post("/reports/mcp", [
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "ping" },
    ]))!;
    const out = JSON.parse(await res.text());
    expect(out.map((r: { id: number }) => r.id)).toEqual([1, 2]);
  });

  it("uses a custom search and can disable tools", async () => {
    const custom = handlerFor(
      twoShelves({
        reports: [
          mcp({
            search: () => [{ book: "q3-2026", chapter: "revenue", title: "Revenue", url: "u", snippet: "s", score: 1 }],
            tools: { get_chapter: false },
          }),
        ],
      }),
    );
    const call = async (msg: unknown) =>
      JSON.parse(
        await (await custom(
          new Request(`${ORIGIN}/reports/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(msg) }),
        ))!.text(),
      );
    const tools = await call({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(tools.result.tools.map((t: { name: string }) => t.name)).toEqual(["list_books", "get_book", "search"]);
    const hits = JSON.parse(
      (await call({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "search", arguments: { query: "x" } } })).result
        .content[0].text,
    );
    expect(hits[0].score).toBe(1);
  });
});

// ------------------------------------------------------------------ dev warnings

describe("development warnings", () => {
  it("warns once for an unowned .md path, and only in development", async () => {
    const handler = handlerFor(twoShelves());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("NODE_ENV", "development");
    await get(handler, "/legacy/intro.md");
    await get(handler, "/legacy/intro.md");
    await get(handler, "/legacy/other.md");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('no bookshelf has basePath "/legacy"');
    expect(warn.mock.calls[0]![0]).toContain("books → /books, reports → /reports");

    warn.mockClear();
    vi.stubEnv("NODE_ENV", "production");
    await get(handler, "/legacy/intro.md");
    expect(warn).not.toHaveBeenCalled();
  });

  it("stamps X-Zreader-Shelf in development only", async () => {
    const handler = handlerFor(twoShelves());
    expect((await get(handler, "/books.md"))!.headers.get("x-zreader-shelf")).toBeNull();
    vi.stubEnv("NODE_ENV", "development");
    const dev = handlerFor(twoShelves());
    expect((await get(dev, "/books.md"))!.headers.get("x-zreader-shelf")).toBe("books");
    expect((await get(dev, "/reports.md"))!.headers.get("x-zreader-shelf")).toBe("reports");
  });
});
