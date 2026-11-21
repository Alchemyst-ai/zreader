import { Node as TiptapNode } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import type { Pad } from "../src/core/index";
import { resolvePadFeatures, type PadFeature } from "../src/editor/features";

/** A fake optional feature: adds one node type, written in Markdown as `@<name>`, on when `ctx[name]` is set. */
function fake(name: "alpha" | "beta"): PadFeature<{ alpha?: boolean; beta?: boolean }> {
  return {
    name,
    nodeTypes: [name],
    markdownHas: (md) => md.includes(`@${name}`),
    activate: (ctx) => (ctx[name] ? { extensions: [TiptapNode.create({ name, group: "block", atom: true })] } : null),
  };
}
const FEATURES = [fake("alpha"), fake("beta")];

const pad = (markdown: string, nodes?: string[]): Pad => ({
  markdown,
  json: nodes && { type: "doc", content: nodes.map((type) => ({ type })) },
  updatedAt: "2026-11-22T00:00:00.000Z",
});

describe("optional pad features", () => {
  it("loads only the extensions of features that are on", () => {
    const names = (ctx: { alpha?: boolean; beta?: boolean }) => resolvePadFeatures(ctx, FEATURES).extensions.map((e) => e.name);
    expect(names({})).toEqual([]);
    expect(names({ beta: true })).toEqual(["beta"]);
    expect(names({ alpha: true, beta: true })).toEqual(["alpha", "beta"]);
  });

  it("uses the cached JSON only when it was made with the same features as now", () => {
    const both = resolvePadFeatures({ alpha: true, beta: true }, FEATURES);
    const alphaOnly = resolvePadFeatures({ alpha: true }, FEATURES);
    const none = resolvePadFeatures({}, FEATURES);

    // JSON holding a feature's nodes needs that feature on.
    expect(both.contentFor(pad("@alpha @beta", ["alpha", "beta"])).contentType).toBe("json");
    expect(alphaOnly.contentFor(pad("@alpha @beta", ["alpha", "beta"])).contentType).toBe("markdown");
    expect(none.contentFor(pad("@alpha", ["alpha"])).contentType).toBe("markdown");

    // JSON made with a feature off is stale once the feature is on and the Markdown uses it.
    expect(both.contentFor(pad("@beta", ["paragraph"])).contentType).toBe("markdown");
    expect(alphaOnly.contentFor(pad("@beta", ["paragraph"])).contentType).toBe("json");

    // Plain pads keep their JSON whatever is on; pads without JSON load Markdown.
    expect(both.contentFor(pad("plain", ["paragraph"]))).toEqual({ content: { type: "doc", content: [{ type: "paragraph" }] }, contentType: "json" });
    expect(none.contentFor(pad("plain"))).toEqual({ content: "plain", contentType: "markdown" });
  });

  it("finds a feature's nodes nested anywhere in the JSON", () => {
    const nested: Pad = { markdown: "> @alpha", json: { type: "doc", content: [{ type: "blockquote", content: [{ type: "alpha" }] }] }, updatedAt: "" };
    expect(resolvePadFeatures({}, FEATURES).contentFor(nested).contentType).toBe("markdown");
    expect(resolvePadFeatures({ alpha: true }, FEATURES).contentFor(nested).contentType).toBe("json");
  });
});
