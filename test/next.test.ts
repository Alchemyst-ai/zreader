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

describe("withReader — images", () => {
  it("adds remotePatterns for allowRemote hosts and keeps the user's", async () => {
    const { readerImagesConfig } = await import("../src/next/index");
    const resolved = resolveConfig({ content: { images: { allowRemote: ["cdn.example.com"] } } }, null, { root: "/proj" });
    const out = readerImagesConfig({ remotePatterns: [{ protocol: "https", hostname: "own.dev" }] }, resolved);
    expect(out?.remotePatterns).toEqual([
      { protocol: "https", hostname: "own.dev" },
      { protocol: "https", hostname: "cdn.example.com" },
      { protocol: "https", hostname: "**.cdn.example.com" },
      { protocol: "http", hostname: "cdn.example.com" },
      { protocol: "http", hostname: "**.cdn.example.com" },
    ]);
  });

  it("adds nothing for allowRemote: true", async () => {
    const { readerImagesConfig } = await import("../src/next/index");
    expect(readerImagesConfig(undefined, resolveConfig({}, null, { root: "/proj" }))).toBeUndefined();
  });
});

describe("next/image for chapter images", () => {
  it("decides optimize / unoptimized / plain img per source", async () => {
    const { imageDecision } = await import("../src/next/server/image");
    const any = { allowRemote: true as const };
    const list = { allowRemote: ["cdn.dev"] };
    expect(imageDecision("/img/a.png", false, any)).toBe("optimize");
    expect(imageDecision("/img/a.png?v=1", false, any)).toBe("unoptimized");
    expect(imageDecision("/img/a.svg", false, any)).toBe("unoptimized");
    expect(imageDecision("data:image/png;base64,AAAA", false, any)).toBe("unoptimized");
    expect(imageDecision("https://cdn.dev/a.png", false, any)).toBe("unoptimized");
    expect(imageDecision("https://img.cdn.dev/a.png", false, list)).toBe("optimize");
    expect(imageDecision("https://other.dev/a.png", false, list)).toBe("unoptimized");
    expect(imageDecision("./a.png", false, any)).toBe("img");
    expect(imageDecision("/a.png", true, any)).toBe("img");
  });

  it("renders compiled chapter HTML through next/image", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { createReaderImage } = await import("../src/next/server/image");
    const { htmlToReact, renderMarkdown } = await import("../src/content/index");
    const r = await renderMarkdown("Text.\n\n![A](/img/a.png)\n\n![B](https://x.dev/b.png)\n\n![C](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=)", {
      images: { warn: () => {} },
    });
    const img = createReaderImage({ allowRemote: true });
    const html = renderToStaticMarkup(createElement("div", null, htmlToReact(r.html, { components: { img: img as never } })));
    expect(html).toContain('<p data-block-id="p-');
    // Optimized local image with unknown size: next/image srcset through /_next/image.
    expect(html).toMatch(/<img alt="A"[^>]*src="\/_next\/image\?url=%2Fimg%2Fa\.png/);
    expect(html).toMatch(/<img alt="B"[^>]*src="https:\/\/x\.dev\/b\.png"/);
    expect(html).toMatch(/<img alt="C"[^>]*width="1" height="1"[^>]*src="data:image\/png;base64,/);
    expect(html).toContain('data-zr-zoom=""');
  });
});
