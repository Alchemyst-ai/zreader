// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { connectSandbox, type RunEvent, type RunRequest, type SandboxClient, type SandboxSettings } from "../src/core/index";
import { chapterKernel, enhanceChapterRunnables } from "../src/react/chapter-runnable";

const SETTINGS: SandboxSettings = { runTimeoutMs: false, idleTimeoutMs: false, permissions: { scratchpad: { dangerousPermissions: {} } } };

/** A Sandbox that keeps variables per Kernel: `x = 1` sets, `x` reads, anything else echoes. */
function fakeSandbox(languages: RunRequest["language"][] = ["python"]) {
  const runs: RunRequest[] = [];
  const restarts: string[] = [];
  const vars = new Map<string, Record<string, string>>();
  const client: SandboxClient = {
    languages,
    async *run(req) {
      runs.push(req);
      yield { type: "started" } as RunEvent;
      const scope = vars.get(`${req.kernel}|${req.language}`) ?? {};
      vars.set(`${req.kernel}|${req.language}`, scope);
      const set = /^(\w+) = (.+)$/.exec(req.code);
      if (set) scope[set[1]!] = set[2]!;
      else if (req.code in scope) yield { type: "result", text: scope[req.code]! } as RunEvent;
      else yield { type: "stdout", text: `ran ${req.code}\n` } as RunEvent;
      yield { type: "exit", ok: true, ms: 1 } as RunEvent;
    },
    async restart(kernel, language) {
      restarts.push(`${kernel}|${language}`);
      vars.delete(`${kernel}|${language}`);
    },
    dispose() {},
  };
  const sandbox = connectSandbox({ languages, load: async () => client }, SETTINGS);
  return { sandbox, runs, restarts };
}

const PAGE = `<p>Intro.</p>
<pre data-zr-runnable="python" data-zr-runnable-id="a" data-block-id="pre-1"><code class="language-python">x = 41
</code></pre>
<pre data-zr-output-for="a"><code class="language-output">(nothing)
</code></pre>
<pre data-zr-runnable="python" data-zr-runnable-id="b"><code class="language-python">x
</code></pre>
<pre data-zr-runnable="javascript" data-zr-runnable-id="c"><code class="language-javascript">1 + 1</code></pre>
<pre><code>plain</code></pre>`;

function page(html = PAGE) {
  const root = document.createElement("article");
  root.innerHTML = html;
  document.body.append(root);
  return root;
}
const settle = () => new Promise((r) => setTimeout(r, 10));
const hosts = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(".zr-chapter-runnable")];
const press = (host: HTMLElement, label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click();
const outputOf = (host: HTMLElement) => host.querySelector(".zr-chapter-runnable-output-text")!.textContent;

describe("RunnableCode in chapters: running", () => {
  it("adds controls to the RunnableCode the Sandbox runs, ignored by highlighting, and runs nothing on its own", async () => {
    const { sandbox, runs } = fakeSandbox();
    const root = page();
    enhanceChapterRunnables(root, { sandbox, kernel: "k" });
    await settle();
    const all = hosts(root);
    expect(all).toHaveLength(2); // the JavaScript block stays plain: this Sandbox runs Python only
    expect(all.every((h) => h.hasAttribute("data-zr-ignore"))).toBe(true);
    expect(root.querySelector('pre[data-zr-runnable="javascript"]')!.nextElementSibling?.classList.contains("zr-chapter-runnable")).toBe(false);
    expect(runs).toEqual([]);
  });

  it("runs the author's code as chapter code, in the page's Kernel, and keeps variables between examples", async () => {
    const { sandbox, runs } = fakeSandbox();
    const root = page();
    enhanceChapterRunnables(root, { sandbox, kernel: chapterKernel("guide", "intro") });
    const [a, b] = hosts(root);
    press(b!, "Run");
    await settle();
    expect(outputOf(b!)).toBe("ran x\n");
    press(a!, "Run");
    await settle();
    press(b!, "Run");
    await settle();
    expect(outputOf(b!)).toBe("41\n");
    expect(runs[0]).toMatchObject({ runnableId: "b", language: "python", code: "x", codeSource: "chapter" });
    expect(runs[0]!.kernel).toMatch(/^page:guide:intro#/);
  });

  it("shows the author's Output until the first run, then the reader's", async () => {
    const { sandbox } = fakeSandbox();
    const root = page();
    enhanceChapterRunnables(root, { sandbox, kernel: "k" });
    const authorOut = root.querySelector<HTMLElement>('pre[data-zr-output-for="a"]')!;
    expect(authorOut.hidden).toBe(false);
    press(hosts(root)[0]!, "Run");
    await settle();
    expect(authorOut.hidden).toBe(true);
  });

  it("runs edited code with Shift+Enter, hides the author's code while edited, and Reset brings it back", async () => {
    const { sandbox, runs } = fakeSandbox();
    const root = page();
    enhanceChapterRunnables(root, { sandbox, kernel: "k" });
    const [, b] = hosts(root);
    const pre = root.querySelector<HTMLElement>('pre[data-zr-runnable-id="b"]')!;
    press(b!, "Edit code");
    const editor = b!.querySelector("textarea")!;
    expect(editor.value).toBe("x");
    expect(pre.hidden).toBe(true);
    editor.value = "print(2)";
    editor.dispatchEvent(new Event("input"));
    expect(b!.dataset.edited).toBe("true");
    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }));
    await settle();
    expect(runs.at(-1)!.code).toBe("print(2)");
    press(b!, "Reset to the author's code");
    expect(pre.hidden).toBe(false);
    expect(editor.hidden).toBe(true);
    press(b!, "Run");
    await settle();
    expect(runs.at(-1)!.code).toBe("x");
  });

  it("copies the code and its last Output to the scratchpad as RunnableCode", async () => {
    const { sandbox } = fakeSandbox();
    const root = page();
    const copied: string[] = [];
    enhanceChapterRunnables(root, { sandbox, kernel: "k", copyToPad: (md) => copied.push(md) });
    const [a, b] = hosts(root);
    press(a!, "Copy to scratchpad");
    expect(copied[0]).toMatch(/^```python run id=(\w+)\nx = 41\n```\n```output for=\1\n\(nothing\)\n```$/);
    press(b!, "Run");
    await settle();
    press(b!, "Copy to scratchpad");
    expect(copied[1]).toMatch(/^```python run id=(\w+)\nx\n```\n```output for=\1\nran x\n```$/);
  });

  it("has no Copy to scratchpad without a pad to copy to", () => {
    const root = page();
    enhanceChapterRunnables(root, { sandbox: fakeSandbox().sandbox, kernel: "k" });
    expect(hosts(root)[0]!.querySelector('button[aria-label="Copy to scratchpad"]')).toBeNull();
  });

  it("cleans up on leaving the page: controls gone, author code and Output back, Kernels ended", async () => {
    const { sandbox, restarts } = fakeSandbox();
    const root = page();
    const before = root.innerHTML;
    const done = enhanceChapterRunnables(root, { sandbox, kernel: "k" });
    press(hosts(root)[1]!, "Edit code");
    press(hosts(root)[0]!, "Run");
    await settle();
    done();
    await settle();
    expect(root.innerHTML).toBe(before);
    expect(restarts).toEqual(["k|python"]);
  });
});

describe("RunnableCode in chapters: in the reader", () => {
  it("is off without a Sandbox or with reader.sandbox.chapters: false", async () => {
    const { act, createElement: h, useState } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { ReaderProvider } = await import("../src/react/index");
    const { useChapterRunnables } = await import("../src/react/chapter-runnable");
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const fake = fakeSandbox();
    const loader = { languages: ["python" as const], load: async () => fake.sandbox.client() };
    function Chapter() {
      const [el, setEl] = useState<HTMLElement | null>(null);
      useChapterRunnables(el, { bookId: "b", chapterId: "c", contentKey: PAGE });
      return h("article", { ref: setEl, dangerouslySetInnerHTML: { __html: PAGE } });
    }
    const mount = async (props: Record<string, unknown>) => {
      const div = document.createElement("div");
      document.body.append(div);
      const r = createRoot(div);
      await act(async () => r.render(h(ReaderProvider, { manageTheme: false, toaster: false, ...props, children: h(Chapter) })));
      return { div, r };
    };
    const on = await mount({ sandbox: loader });
    expect(on.div.querySelectorAll(".zr-chapter-runnable")).toHaveLength(2);
    const off = await mount({ sandbox: loader, options: { sandbox: { chapters: false } } });
    expect(off.div.querySelectorAll(".zr-chapter-runnable")).toHaveLength(0);
    const none = await mount({});
    expect(none.div.querySelectorAll(".zr-chapter-runnable")).toHaveLength(0);
    for (const m of [on, off, none]) await act(async () => m.r.unmount());
  });
});
