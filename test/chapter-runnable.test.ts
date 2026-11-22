import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { chapterBodyToMarkdown } from "../src/agent/markdown";
import { compileMdx, renderHtml, renderMarkdown, runMdx } from "../src/content/pipeline";
import { RunnableCode } from "../src/react/components/mdx";

const MD = "Intro.\n\n```python run id=k3\nx = 41\nx + 1\n```\n```output for=k3\n42\n```\n\nAfter.";

/** The `pre` elements of some HTML, with their attributes and text. */
function pres(html: string) {
  return [...html.matchAll(/<pre([^>]*)>([\s\S]*?)<\/pre>/g)].map(([, attrs, inner]) => ({
    attrs: Object.fromEntries([...attrs!.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1]!, m[2]!])),
    text: inner!.replace(/<[^>]+>/g, "").replace(/&#x3C;|&lt;/g, "<").replace(/&gt;/g, ">"),
  }));
}

describe("RunnableCode in chapters: the content pipeline", () => {
  it("marks runnable fences and their author Output in Markdown chapters", async () => {
    const [code, output] = pres((await renderMarkdown(MD)).html);
    expect(code!.attrs).toMatchObject({ "data-zr-runnable": "python", "data-zr-runnable-id": "k3" });
    expect(code!.attrs["data-block-id"]).toBeTruthy();
    expect(code!.text).toBe("x = 41\nx + 1\n");
    expect(output!.attrs).toMatchObject({ "data-zr-output-for": "k3" });
    expect(output!.text).toBe("42\n");
  });

  it("gives RunnableCode without an id a stable one, and pairs the Output fence right after it", async () => {
    const md = "```py run\nprint(1)\n```\n\n```output\n1\n```";
    const [a, out] = pres((await renderMarkdown(md)).html);
    const [b] = pres((await renderMarkdown(md)).html);
    expect(a!.attrs["data-zr-runnable"]).toBe("python");
    expect(a!.attrs["data-zr-runnable-id"]).toMatch(/^[a-z0-9]+$/);
    expect(b!.attrs["data-zr-runnable-id"]).toBe(a!.attrs["data-zr-runnable-id"]);
    expect(out!.attrs["data-zr-output-for"]).toBe(a!.attrs["data-zr-runnable-id"]);
  });

  it("keeps ids unique when identical RunnableCode has none", async () => {
    const ids = pres((await renderMarkdown("```py run\n1\n```\n\n```py run\n1\n```")).html).map((p) => p.attrs["data-zr-runnable-id"]);
    expect(ids[0]).not.toBe(ids[1]);
    expect(ids[1]).toBe(`${ids[0]}-2`);
  });

  it("gives MDX RunnableCode block ids at build time", async () => {
    const { code } = await compileMdx(MD);
    const [pre] = pres(renderToStaticMarkup(h(await runMdx(code))));
    expect(pre!.attrs["data-block-id"]).toMatch(/^pre-/);
    expect(pre!.text).toBe("x = 41\nx + 1\n");
  });

  it("leaves other fences alone: no `run`, an unknown language, an Output for another id", async () => {
    const md = "```python\nx\n```\n\n```rust run\nfn main(){}\n```\n\n```js run id=a\n1\n```\n```output for=b\n1\n```";
    const out = pres((await renderMarkdown(md)).html);
    expect(out.map((p) => p.attrs["data-zr-runnable"] ?? null)).toEqual([null, null, "javascript", null]);
    expect(out[3]!.attrs["data-zr-output-for"]).toBeUndefined();
  });

  it("drops the markers from HTML chapters", async () => {
    const { html } = await renderHtml('<pre data-zr-runnable="python" data-zr-runnable-id="x"><code>1</code></pre>');
    expect(html).not.toContain("data-zr-runnable");
  });

  it("marks runnable fences in MDX chapters too", async () => {
    const { code } = await compileMdx(MD);
    const Content = await runMdx(code);
    const [pre, output] = pres(renderToStaticMarkup(h(Content)));
    expect(pre!.attrs).toMatchObject({ "data-zr-runnable": "python", "data-zr-runnable-id": "k3" });
    expect(output!.attrs).toMatchObject({ "data-zr-output-for": "k3" });
  });

  it("renders the same markers from <RunnableCode> in MDX", async () => {
    const { code } = await compileMdx('<RunnableCode language="py" id="m1" code={"x = 1\\nx"} output="1" />');
    const Content = await runMdx(code);
    const [pre, output] = pres(renderToStaticMarkup(h(Content, { components: { RunnableCode } as never })));
    expect(pre!.attrs).toMatchObject({ "data-zr-runnable": "python", "data-zr-runnable-id": "m1" });
    expect(pre!.text).toBe("x = 1\nx");
    expect(output!.attrs).toMatchObject({ "data-zr-output-for": "m1" });
    expect(output!.text).toBe("1");
  });

  it("shows plain code for <RunnableCode> in an unknown language", () => {
    const html = renderToStaticMarkup(h(RunnableCode, { language: "rust", code: "fn main(){}" }));
    expect(html).not.toContain("data-zr-runnable");
    expect(html).toContain("fn main(){}");
  });
});

describe("RunnableCode in chapters: .md twins", () => {
  const twin = (format: "md" | "mdx", body: string) => chapterBodyToMarkdown({ file: `/x/${Math.random()}.${format}`, mtimeMs: 1, format, body });

  it("shows plain fences in Markdown twins, and leaves everything else as written", async () => {
    const out = await twin("md", `${MD}\n\n> \`\`\`js run id=q\n> 1\n> \`\`\`\n\n\`\`\`python\n\`\`\`py run\n\`\`\`\n`);
    expect(out).toBe(
      "Intro.\n\n```python\nx = 41\nx + 1\n```\n```text\n42\n```\n\nAfter.\n\n> ```javascript\n> 1\n> ```\n\n```python\n```py run\n```\n",
    );
  });

  it("pairs Outputs in twins exactly as the page does", async () => {
    // An Output naming another id, or not right after its code, stays an `output` fence.
    const body = "```py run id=a\n1\n```\n```output for=b\n1\n```\n\n```output for=a\nlate\n```\n";
    expect(await twin("md", body)).toBe("```python\n1\n```\n```output for=b\n1\n```\n\n```output for=a\nlate\n```\n");
    const mdx = await twin("mdx", body);
    expect(mdx).toContain("```output for=b");
  });

  it("keeps CRLF line endings, and ignores inline code and indented code that look like fences", async () => {
    expect(await twin("md", "```py run\r\nx\r\n```\r\n")).toBe("```python\r\nx\r\n```\r\n");
    const body = "Use ```js run``` inline.\n\n    ```py run\n    indented\n\n```py run\ny\n```\n";
    expect(await twin("md", body)).toBe("Use ```js run``` inline.\n\n    ```py run\n    indented\n\n```python\ny\n```\n");
  });

  it("decodes string attributes of <RunnableCode>, and keeps a note for code it can't read", async () => {
    const out = await twin("mdx", "<RunnableCode language='js' code={'a = \\'x\\''} />\n\n<RunnableCode language=\"py\" code={`print(1)\\nprint(2)`} />\n\n<RunnableCode language=\"py\" code={source} />\n");
    expect(out).toContain("```javascript\na = 'x'\n```");
    expect(out).toContain("```python\nprint(1)\nprint(2)\n```");
    expect(out).toContain("(Runnable code: see the page.)");
  });

  it("returns Markdown without RunnableCode unchanged", async () => {
    const body = "# T\n\n* a\n* b\n\n```python\nx\n```\n";
    expect(await twin("md", body)).toBe(body);
  });

  it("shows plain fences in MDX twins, including <RunnableCode>", async () => {
    const out = await twin("mdx", `${MD}\n\n<RunnableCode language="ts" code={"let a: number = 1"} output="1" />\n`);
    expect(out).toContain("```python\nx = 41\nx + 1\n```");
    expect(out).toContain("```text\n42\n```");
    expect(out).toContain("```typescript\nlet a: number = 1\n```\n\n```text\n1\n```");
    expect(out).not.toContain("run");
  });
});
