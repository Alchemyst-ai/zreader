import { describe, expect, it } from "vitest";
import { glob, resolveConfig } from "../src/config/index";
import { applyReaderConfig } from "../src/next/index";

describe("withReader / applyReaderConfig — bookshelves", () => {
  it("traces every shelf's content folder for /**, proxy and middleware", () => {
    const resolved = resolveConfig(
      {
        bookshelves: [
          { id: "books", basePath: "/books", content: { loader: glob({ base: "./content/books" }) } },
          { id: "reports", basePath: "/reports", content: { loader: glob({ base: "./content/reports" }) } },
          { id: "archive", basePath: "/archive", content: { loader: glob({ base: "./content/books" }) } },
        ],
      },
      null,
      { root: "/proj" },
    );
    const out = applyReaderConfig({}, { configFile: "/proj/reader.config.ts", resolved }, "/proj");
    // One shelf per folder: duplicates are traced once.
    expect(out.outputFileTracingIncludes).toEqual({
      "/**": ["content/books/**/*", "content/reports/**/*"],
      middleware: ["content/books/**/*", "content/reports/**/*"],
      proxy: ["content/books/**/*", "content/reports/**/*"],
    });
  });

  it("keeps the existing tracing entries", () => {
    const resolved = resolveConfig({}, null, { root: "/proj" });
    const out = applyReaderConfig(
      { outputFileTracingIncludes: { "/api/x": ["./data/**"], "/**": ["./shared/**"] } },
      { configFile: null, resolved },
      "/proj",
    );
    expect(out.outputFileTracingIncludes).toMatchObject({
      "/api/x": ["./data/**"],
      "/**": expect.arrayContaining(["./shared/**", "content/books/**/*"]),
    });
  });
});
