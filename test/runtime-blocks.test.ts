// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { collectToc, ensureBlockIds, BLOCK_ATTR } from "../src/core/index";
import { renderHtml, renderMarkdown } from "../src/content/index";

const md = `# Title

Intro paragraph with **bold** text.

## Setup

- First item
- Second item

> A quoted line.

## Setup

Same heading twice, and a repeated line:

Repeated.

Repeated.

| Col | Other |
| --- | ----- |
| a   | b     |
`;

function idsOf(root: Element) {
  return {
    blocks: Array.from(root.querySelectorAll(`[${BLOCK_ATTR}]`)).map((e) => `${e.tagName.toLowerCase()}:${e.getAttribute(BLOCK_ATTR)}`),
    headings: Array.from(root.querySelectorAll("h1,h2,h3,h4,h5,h6")).map((e) => e.getAttribute("id")),
  };
}

describe("in-browser block ids (directly rendered MDX/JSX)", () => {
  it("match the rehype plugin's ids exactly", async () => {
    const built = await renderMarkdown(md);
    const withIds = document.createElement("div");
    withIds.innerHTML = built.html;

    // The same content as a bundler (or JSX) would render it: no ids at all.
    const bare = document.createElement("div");
    bare.innerHTML = built.html;
    bare.querySelectorAll(`[${BLOCK_ATTR}]`).forEach((e) => e.removeAttribute(BLOCK_ATTR));
    bare.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((e) => e.removeAttribute("id"));

    const { assigned } = ensureBlockIds(bare);
    expect(assigned).toBe(built.blocks.length);
    expect(idsOf(bare)).toEqual(idsOf(withIds));
    expect(idsOf(bare).headings).toEqual(["title", "setup", "setup-1"]);
    expect(idsOf(bare).blocks.filter((b) => b.startsWith("p:")).some((b) => /-2$/.test(b))).toBe(true); // "Repeated." twice
  });

  it("keeps author ids on headings and only touches innermost blocks", () => {
    const root = document.createElement("div");
    root.innerHTML = `<h2 id="custom">Custom</h2><blockquote><p>Inner</p></blockquote><ul><li><p>Nested</p></li></ul>`;
    ensureBlockIds(root);
    expect(root.querySelector("h2")!.id).toBe("custom");
    expect(root.querySelector("blockquote")!.hasAttribute(BLOCK_ATTR)).toBe(false);
    expect(root.querySelector("blockquote p")!.hasAttribute(BLOCK_ATTR)).toBe(true);
    expect(root.querySelector("li")!.hasAttribute(BLOCK_ATTR)).toBe(false);
  });

  it("is a no-op when the content already has ids", async () => {
    const built = await renderHtml("<p>One</p><p>Two</p>");
    const root = document.createElement("div");
    root.innerHTML = built.html;
    const before = root.innerHTML;
    expect(ensureBlockIds(root).assigned).toBe(0);
    expect(root.innerHTML).toBe(before);
  });

  it("builds a TOC from rendered headings", () => {
    const root = document.createElement("div");
    root.innerHTML = `<h1>Top</h1><h2>Alpha</h2><p>x</p><h3>Beta</h3><h4>Too deep</h4>`;
    ensureBlockIds(root);
    expect(collectToc(root)).toEqual([
      { id: "alpha", depth: 2, text: "Alpha" },
      { id: "beta", depth: 3, text: "Beta" },
    ]);
  });
});
