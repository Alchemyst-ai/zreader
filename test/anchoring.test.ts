// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  buildTextIndex,
  describeSpan,
  expandSpanToSentences,
  rangeToSpan,
  resolveAnchor,
  resolveInText,
  sentenceAt,
  sentenceSpanAt,
  snapToWords,
  spanToRange,
  quoteFor,
  type Anchor,
} from "../src/core/index";

describe("text anchoring", () => {
  const text = "The quick brown fox jumps over the lazy dog. The quick brown fox sleeps.";
  const mkAnchor = (start: number, end: number): Anchor => ({ blockId: "p", blockStart: start, start, end, ...quoteFor(text, start, end) });

  it("uses the stored position when it still matches", () => {
    expect(resolveInText(text, mkAnchor(4, 9))).toMatchObject({ start: 4, end: 9, strategy: "position" });
  });

  it("re-anchors by block offset after content is inserted before the block", () => {
    const a = mkAnchor(4, 9);
    const edited = "Intro paragraph.\n" + text;
    expect(resolveInText(edited, a, 17)).toMatchObject({ start: 21, end: 26, strategy: "block" });
  });

  it("disambiguates repeated quotes by context", () => {
    const second = text.lastIndexOf("quick brown fox");
    const a = mkAnchor(second, second + 15);
    const edited = "Prelude. " + text;
    const r = resolveInText(edited, a);
    expect(r?.strategy).toBe("quote");
    expect(r?.start).toBe(second + 9);
  });

  it("falls back to fuzzy matching for lightly edited passages", () => {
    const a = mkAnchor(0, 43); // whole first sentence
    const edited = text.replace("jumps over", "jumped over");
    const r = resolveInText(edited, a);
    expect(r?.strategy).toBe("fuzzy");
    expect(edited.slice(r!.start, r!.end)).toContain("jumped over the lazy dog");
  });

  it("returns null when the passage is gone", () => {
    expect(resolveInText("Completely different.", mkAnchor(4, 9))).toBeNull();
  });

  it("finds sentences with Intl.Segmenter", () => {
    expect(text.slice(...Object.values(sentenceAt(text, 50)) as [number, number])).toBe("The quick brown fox sleeps.");
    expect(sentenceAt(text, 3)).toEqual({ start: 0, end: 44 });
  });

  it("snaps selections to word boundaries", () => {
    expect(snapToWords(text, 6, 12)).toEqual({ start: 4, end: 15 }); // "uick br" -> "quick brown"
  });
});

describe("DOM anchoring", () => {
  function setup() {
    document.body.innerHTML = `
      <article id="root">
        <h2 data-block-id="h2-a" id="intro">Intro</h2>
        <p data-block-id="p-1">First sentence here. <em>Second</em> sentence follows!</p>
        <p data-block-id="p-2">Another <a href="#">linked</a> paragraph.</p>
        <aside data-zr-ignore>ignored text</aside>
      </article>`;
    const root = document.getElementById("root")!;
    return { root, index: buildTextIndex(root) };
  }

  it("indexes text and skips ignored regions", () => {
    const { index } = setup();
    expect(index.text).toContain("First sentence here. Second sentence follows!");
    expect(index.text).not.toContain("ignored");
  });

  it("round-trips Range ↔ span ↔ anchor across element boundaries", () => {
    const { index } = setup();
    const start = index.text.indexOf("here.");
    const end = index.text.indexOf(" sentence follows");
    const range = spanToRange(index, { start, end })!;
    expect(range.toString()).toBe("here. Second");
    expect(rangeToSpan(index, range)).toEqual({ start, end });

    const anchor = describeSpan(index, { start, end }, "hash")!;
    expect(anchor).toMatchObject({ blockId: "p-1", exact: "here. Second", contentHash: "hash" });
    expect(resolveAnchor(index, anchor)).toEqual({ start, end, strategy: "position" });
  });

  it("re-resolves after a paragraph is inserted above", () => {
    const { root, index } = setup();
    const start = index.text.indexOf("linked");
    const anchor = describeSpan(index, { start, end: start + 6 })!;
    root.insertAdjacentHTML("afterbegin", "<p data-block-id='p-0'>A brand new opening paragraph.</p>");
    const next = buildTextIndex(root);
    const span = resolveAnchor(next, anchor)!;
    expect(next.text.slice(span.start, span.end)).toBe("linked");
  });

  it("selects and expands whole sentences within a block", () => {
    const { index } = setup();
    const inSecond = index.text.indexOf("Second") + 2;
    const s = sentenceSpanAt(index, inSecond)!;
    expect(index.text.slice(s.start, s.end)).toBe("Second sentence follows!");
    const e = expandSpanToSentences(index, { start: index.text.indexOf("here"), end: inSecond });
    expect(index.text.slice(e.start, e.end)).toBe("First sentence here. Second sentence follows!");
  });
});
