/**
 * RunnableCode in chapters: a fenced block with `run` in its info string
 * (```` ```python run id=k3 ````) becomes a marked `pre`, and an `output` fence
 * right after it (```` ```output for=k3 ````) becomes the author's Output. Both
 * stay ordinary code blocks in the HTML, so the page reads the same before
 * JavaScript loads and wherever RunnableCode is off; the reader makes marked
 * blocks runnable in the browser.
 *
 *   <pre data-zr-runnable="python" data-zr-runnable-id="k3"><code class="language-python">…</code></pre>
 *   <pre data-zr-output-for="k3"><code class="language-output">…</code></pre>
 */
import type { Element, ElementContent, Root, RootContent } from "hast";
import { RUNNABLE_ID, codeFingerprint, fenceAttr, isRunnableMeta, sandboxLanguage } from "zreader";

type Parent = { children: Array<RootContent | ElementContent> };

/** A `pre > code` fence: its language word, meta and text. */
function fence(node: RootContent | ElementContent | undefined): { pre: Element; lang: string; meta: string; text: string } | null {
  if (node?.type !== "element" || node.tagName !== "pre") return null;
  const code = node.children.find((c): c is Element => c.type === "element" && c.tagName === "code");
  if (!code) return null;
  const cls = ([] as unknown[]).concat(code.properties?.className ?? []).map(String);
  const lang = cls.find((c) => c.startsWith("language-"))?.slice("language-".length) ?? "";
  const meta = String((code.data as { meta?: string } | undefined)?.meta ?? "");
  const text = (function walk(n: ElementContent | Element): string {
    return n.type === "text" ? n.value : "children" in n ? n.children.map(walk).join("") : "";
  })(code);
  return { pre: node, lang, meta, text };
}

function mark(parent: Parent) {
  const kids = parent.children;
  for (let i = 0; i < kids.length; i++) {
    const node = kids[i]!;
    if (node.type === "element") mark(node);
    const f = fence(node);
    if (!f) continue;
    const language = sandboxLanguage(f.lang);
    if (!language || !isRunnableMeta(f.meta)) continue;
    const given = fenceAttr(f.meta, "id");
    const id = given && RUNNABLE_ID.test(given) ? given : `c${codeFingerprint(language, f.text)}`;
    f.pre.properties = { ...f.pre.properties, dataZrRunnable: language, dataZrRunnableId: id };
    // The author's Output: the next block, if it's an `output` fence for this code.
    let j = i + 1;
    while (j < kids.length && kids[j]!.type === "text" && !(kids[j] as { value: string }).value.trim()) j++;
    const out = fence(kids[j]);
    if (out && out.lang === "output" && (given ? fenceAttr(out.meta, "for") === given : !fenceAttr(out.meta, "for"))) {
      out.pre.properties = { ...out.pre.properties, dataZrOutputFor: id };
      i = j;
    }
  }
}

/** Marks RunnableCode and its author Output. Runs on hast straight from remark-rehype, while fences still carry their meta. */
export function rehypeRunnable() {
  return (tree: Root) => mark(tree as unknown as Parent);
}
