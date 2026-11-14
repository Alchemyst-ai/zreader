import { describe, expect, it } from "vitest";
import { mergeConfig, resolveConfig, ReaderConfigError, glob, z } from "../src/config/index";
import { applyReaderConfig, USER_CONFIG_SPECIFIER, EMPTY_CONFIG_SPECIFIER } from "../src/next/index";
import { cors, disable, frontmatter, llmsTxt, mcp, notFound } from "../src/plugins/agent/index";

describe("config", () => {
  it("merges defaults ← file ← inline; arrays replace", () => {
    const c = resolveConfig(
      { reader: { highlightColors: ["green", "blue"], defaultHighlightColor: "green", progress: { completeAt: 0.8 } } },
      { reader: { basePath: "/read" } },
      { root: "/proj" },
    );
    expect(c.reader.highlightColors).toEqual(["green", "blue"]);
    expect(c.reader.progress).toEqual({ completeAt: 0.8, saveIntervalMs: 1000 });
    expect(c.reader.basePath).toBe("/read");
    expect(c.content.loader.base).toBe("./content/books");
    expect(c.root).toBe("/proj");
  });

  it("keeps schema instances (no deep merge into class instances)", () => {
    const book = z.object({ title: z.string(), isbn: z.string() });
    expect(resolveConfig({ content: { schemas: { book } } }).content.schemas.book).toBe(book);
  });

  it("throws readable errors", () => {
    try {
      resolveConfig({ reader: { highlightColors: [] as never, basePath: "books" } }, null, { source: "reader.config.ts" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ReaderConfigError);
      expect((e as Error).message).toContain("reader.config.ts");
      expect((e as Error).message).toContain("reader.highlightColors: must be non-empty");
      expect((e as Error).message).toContain("reader.basePath");
    }
  });

  it("mergeConfig ignores undefined", () => {
    expect(mergeConfig({ a: 1, b: { c: 2 } }, { a: undefined, b: { d: 3 } })).toEqual({ a: 1, b: { c: 2, d: 3 } });
  });
});

describe("bookshelves", () => {
  const shelf = (id: string, basePath: string, extra: Record<string, unknown> = {}) => ({
    id,
    basePath,
    content: { loader: glob({ base: `./content/${id}` }) },
    ...extra,
  });

  it("creates one implicit shelf when bookshelves is absent", () => {
    const c = resolveConfig({ reader: { basePath: "/read" } }, null, { root: "/proj" });
    expect(c.shelves).toHaveLength(1);
    expect(c.shelves[0]).toMatchObject({ id: "books", basePath: "/read", title: "Books" });
    expect(c.defaultShelf).toBe("books");
    expect(c.content).toBe(c.shelves[0]!.content);
    expect(c.reader).toBe(c.shelves[0]!.reader);
  });

  it("merges content and reader over the top level, and keeps plugins", () => {
    const c = resolveConfig(
      {
        content: { sanitize: { allowIframes: ["youtube.com"] } },
        reader: { defaultTheme: "sepia", storagePrefix: "press" },
        agent: { plugins: [frontmatter(), notFound()] },
        bookshelves: [
          shelf("books", "/books", { reader: { defaultTheme: "dark" } }),
          shelf("reports", "/reports", { title: "Quarterly reports", description: "Q.", agent: { plugins: [llmsTxt()] } }),
        ],
      },
      null,
      { root: "/proj" },
    );
    expect(c.shelves[0]!.reader.defaultTheme).toBe("dark");
    expect(c.shelves[0]!.reader.basePath).toBe("/books");
    expect(c.shelves[0]!.content.sanitize.allowIframes).toEqual(["youtube.com"]);
    expect(c.shelves[0]!.content.loader.base).toBe("./content/books");
    expect(c.shelves[1]!.title).toBe("Quarterly reports");
    expect(c.shelves[1]!.description).toBe("Q.");
    expect(c.shelves[0]!.plugins.map((p) => p.name)).toEqual(["frontmatter", "notFound"]);
    expect(c.shelves[1]!.plugins.map((p) => p.name)).toEqual(["frontmatter", "notFound", "llmsTxt"]);
  });

  it("replaces a same-named plugin in place and drops disabled ones", () => {
    const c = resolveConfig(
      {
        agent: { plugins: [frontmatter(), notFound(), cors()] },
        bookshelves: [shelf("books", "/books", { agent: { plugins: [notFound({ title: "Nope" }), disable("cors")] } })],
      },
      null,
      { root: "/proj" },
    );
    expect(c.shelves[0]!.plugins.map((p) => p.name)).toEqual(["frontmatter", "notFound"]);
  });

  it("keys storage: default shelf keeps the prefix, others get -<id>", () => {
    const c = resolveConfig(
      { bookshelves: [shelf("books", "/books"), shelf("reports", "/reports"), shelf("notes", "/notes", { reader: { storagePrefix: "mine" } })] },
      null,
      { root: "/proj" },
    );
    expect(c.shelves.map((s) => s.reader.storagePrefix)).toEqual(["zr", "zr-reports", "mine"]);
  });

  const errors = (user: Record<string, unknown>) => {
    try {
      resolveConfig(user as never, null, { root: "/proj" });
      return [];
    } catch (e) {
      expect(e).toBeInstanceOf(ReaderConfigError);
      return (e as ReaderConfigError).issues.map((i) => `${i.path}: ${i.message}`);
    }
  };

  it("reports every validation rule with a readable path", () => {
    expect(errors({ bookshelves: [shelf("books", "/books"), shelf("bad id!", "/x")] })).toContain(
      'bookshelves[1].id: use letters, digits, \'-\' or \'_\'',
    );
    expect(errors({ bookshelves: [shelf("books", "/books"), shelf("books", "/x")] })).toContain(
      'bookshelves[1].id: duplicate id "books"',
    );
    expect(errors({ bookshelves: [shelf("books", "/books"), shelf("x", "books")] })).toContain(
      'bookshelves[1].basePath: must start with "/"',
    );
    expect(errors({ bookshelves: [shelf("books", "/books"), shelf("x", "/books")] })).toContain(
      'bookshelves[1].basePath: "/books" is already used by "books"',
    );
    expect(errors({ bookshelves: [shelf("books", "/books/"), shelf("x", "/books")] })).toContain(
      'bookshelves[1].basePath: "/books" is already used by "books"',
    );
    expect(errors({ bookshelves: [shelf("books", "/"), shelf("x", "/books")] })).toContain(
      'bookshelves[0].basePath: "/" would contain every other bookshelf; bookshelves cannot be nested',
    );
    expect(errors({ bookshelves: [shelf("books", "/books"), shelf("x", "/books/shelf1")] })).toContain(
      'bookshelves[1].basePath: "/books/shelf1" is inside "/books" (bookshelf "books"); bookshelves cannot be nested',
    );
    expect(errors({ bookshelves: [shelf("docs", "/docs"), shelf("x", "/docs/books")] })).toContain(
      'bookshelves[1].basePath: "/docs/books" is inside "/docs" (bookshelf "docs"); bookshelves cannot be nested',
    );
    expect(errors({ bookshelves: [shelf("books", "/books"), shelf("x", "/books/shelf1"), shelf("y", "/books")] })).toContain(
      'bookshelves[2].basePath: "/books" is already used by "books"',
    );
    expect(errors({ bookshelves: [shelf("books", "/books"), { id: "x", basePath: "/x", agent: { plugins: [{ nope: 1 }] } }] })).toContain(
      "bookshelves[1].agent.plugins[0]: not a zreader agent plugin",
    );
    expect(
      errors({ bookshelves: [shelf("books", "/books", { agent: { plugins: [llmsTxt(), llmsTxt({ full: true })] } })] }),
    ).toContain('bookshelves[0].agent.plugins: two "llmsTxt" plugins');
  });

  it("allows siblings, a shared parent, and a single root shelf", () => {
    const paths = (bookshelves: Array<{ id: string; basePath: string }>) =>
      resolveConfig({ bookshelves: bookshelves.map((s) => shelf(s.id, s.basePath)) }, null, { root: "/proj" }).shelves.map(
        (s) => s.basePath,
      );
    expect(paths([{ id: "a", basePath: "/books" }, { id: "b", basePath: "/reports" }])).toEqual(["/books", "/reports"]);
    expect(paths([{ id: "a", basePath: "/books" }, { id: "b", basePath: "/bookstore" }])).toEqual(["/books", "/bookstore"]);
    expect(paths([{ id: "a", basePath: "/docs/books" }, { id: "b", basePath: "/docs/reports" }])).toEqual([
      "/docs/books",
      "/docs/reports",
    ]);
    expect(paths([{ id: "a", basePath: "/" }])).toEqual(["/"]);
  });

  it("rejects a top-level basePath when bookshelves is set", () => {
    expect(errors({ reader: { basePath: "/books" }, bookshelves: [shelf("books", "/books")] })).toContain(
      "reader.basePath: set basePath on each bookshelf instead",
    );
  });

  it("validates each shelf's reader and content", () => {
    expect(errors({ bookshelves: [shelf("books", "/books", { reader: { highlightColors: [] } })] })).toContain(
      "bookshelves[0].reader.highlightColors: must be non-empty",
    );
  });

  it("exposes client options per shelf", async () => {
    const { clientOptions } = await import("../src/config/index");
    const c = resolveConfig({ bookshelves: [shelf("books", "/books"), shelf("reports", "/reports")] }, null, { root: "/proj" });
    expect(clientOptions(c).basePath).toBe("/books");
    expect(clientOptions(c, "reports").basePath).toBe("/reports");
    expect(clientOptions(c, "nope")).toBe(c.reader);
  });
});

describe("withReader / applyReaderConfig", () => {
  const resolved = resolveConfig({}, null, { root: "/proj" });

  it("aliases user-config for Turbopack (relative) and webpack (absolute), preserving existing config", () => {
    const out = applyReaderConfig(
      {
        reactStrictMode: true,
        serverExternalPackages: ["sharp"],
        turbopack: { resolveAlias: { underscore: "lodash" } },
        outputFileTracingIncludes: { "/api/x": ["./data/**"] },
      },
      { configFile: "/proj/reader.config.ts", resolved },
      "/proj",
    );
    expect(out.reactStrictMode).toBe(true);
    expect(out.turbopack?.resolveAlias).toEqual({ underscore: "lodash", [USER_CONFIG_SPECIFIER]: "./reader.config.ts" });
    expect(out.serverExternalPackages).toEqual(expect.arrayContaining(["sharp", "jsdom", "isomorphic-dompurify"]));
    expect(out.outputFileTracingIncludes).toEqual({
      "/api/x": ["./data/**"],
      "/**": ["content/books/**/*"],
      middleware: ["content/books/**/*"],
      proxy: ["content/books/**/*"],
    });

    const wp = out.webpack!({ resolve: { alias: { keep: "me" } } } as never, {} as never) as { resolve: { alias: Record<string, string> } };
    expect(wp.resolve.alias).toEqual({ keep: "me", [`${USER_CONFIG_SPECIFIER}$`]: "/proj/reader.config.ts" });
  });

  it("falls back to the empty config stub when there is no config file", () => {
    const out = applyReaderConfig({}, { configFile: null, resolved }, "/proj");
    expect(out.turbopack?.resolveAlias?.[USER_CONFIG_SPECIFIER]).toBe(EMPTY_CONFIG_SPECIFIER);
  });

  it("chains an existing webpack function", () => {
    const out = applyReaderConfig(
      { webpack: (c: { marked?: boolean }) => ({ ...c, marked: true }) } as never,
      { configFile: null, resolved },
      "/proj",
    );
    expect(out.webpack!({} as never, {} as never)).toMatchObject({ marked: true });
  });
});
