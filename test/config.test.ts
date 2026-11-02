import { describe, expect, it } from "vitest";
import { mergeConfig, resolveConfig, ReaderConfigError, z } from "../src/config/index";
import { applyReaderConfig, USER_CONFIG_SPECIFIER, EMPTY_CONFIG_SPECIFIER } from "../src/next/index";

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
    expect(out.outputFileTracingIncludes).toEqual({ "/api/x": ["./data/**"], "/**": ["content/books/**/*"] });

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
