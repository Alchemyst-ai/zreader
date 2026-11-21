/**
 * Optional scratchpad features (math today, RunnableCode next). Each one adds
 * node types to the editor only when the reader's setup provides what it needs,
 * so a pad's cached JSON is only usable when it was made with the same set of
 * features: otherwise the editor loads the Markdown, the stored format.
 */
import type { AnyExtension, Editor } from "@tiptap/core";
import type { ReactNode } from "react";
import type { Pad } from "zreader";

export interface PadFeature<Ctx> {
  name: string;
  /** Node types the feature adds to editor JSON. */
  nodeTypes: readonly string[];
  /** Would this Markdown parse into the feature's nodes when it is on? */
  markdownHas(markdown: string): boolean;
  /** The feature's extensions and toolbar item for this context, or `null` when it is off. */
  activate(ctx: Ctx): { extensions: AnyExtension[]; toolbar?: (editor: Editor) => ReactNode } | null;
}

export interface ResolvedPadFeatures {
  extensions: AnyExtension[];
  toolbar: Array<{ name: string; render: (editor: Editor) => ReactNode }>;
  /** What to load into the editor for this pad: the cached JSON when it matches the features that are on, else the Markdown. */
  contentFor(pad: Pad): { content: unknown; contentType: "json" | "markdown" };
}

type JsonNode = { type?: string; content?: JsonNode[] };

/** Does editor JSON contain any node of these types, at any depth? */
export function jsonHas(json: unknown, types: readonly string[]): boolean {
  const walk = (n: JsonNode | undefined): boolean => !!n && ((n.type !== undefined && types.includes(n.type)) || (n.content ?? []).some(walk));
  return walk(json as JsonNode);
}

export function resolvePadFeatures<Ctx>(ctx: Ctx, features: readonly PadFeature<Ctx>[]): ResolvedPadFeatures {
  const states = features.map((feature) => ({ feature, active: feature.activate(ctx) }));
  return {
    extensions: states.flatMap((s) => s.active?.extensions ?? []),
    toolbar: states.flatMap((s) => (s.active?.toolbar ? [{ name: s.feature.name, render: s.active.toolbar }] : [])),
    contentFor(pad) {
      const json = pad.json;
      const usable =
        json !== undefined &&
        states.every(({ feature, active }) => (jsonHas(json, feature.nodeTypes) ? active != null : !(active && feature.markdownHas(pad.markdown))));
      return usable ? { content: json, contentType: "json" } : { content: pad.markdown, contentType: "markdown" };
    },
  };
}
