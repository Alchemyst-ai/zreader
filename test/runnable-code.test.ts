// @vitest-environment happy-dom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { Marked } from "marked";
import { describe, expect, it } from "vitest";
import { createMemoryAdapter, createReaderStore, type RunEvent, type RunRequest, type SandboxClient, type SandboxLoader } from "../src/core/index";
import { resolvePadFeatures } from "../src/editor/features";
import { PAD_FEATURES } from "../src/editor/pad-features";
import { OUTPUT_LIMIT, TRUNCATED_MARKER, markdownHasRunnable, runnableCode, type RunnableHost } from "../src/editor/runnable";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A Sandbox that answers each piece of code with scripted events. */
function fakeSandbox(script: (req: RunRequest) => RunEvent[]) {
  const runs: RunRequest[] = [];
  const restarts: string[] = [];
  let hang: (() => void) | null = null;
  const client: SandboxClient = {
    languages: ["python", "javascript"],
    async *run(req) {
      runs.push(req);
      for (const e of script(req)) {
        if (e.type === "restarted") await new Promise<void>((r) => (hang = r));
        yield e;
      }
    },
    async restart(kernel, language) {
      restarts.push(`${kernel}|${language}`);
      hang?.();
      hang = null;
    },
    dispose() {},
  };
  const host: RunnableHost = { languages: client.languages, client: async () => client, kernel: "pad:global#tab", codeSource: "scratchpad" };
  return { client, host, runs, restarts };
}

const echo = (req: RunRequest): RunEvent[] => [{ type: "stdout", text: `ran ${req.code}\n` }, { type: "exit", ok: true, ms: 1 }];

function headless(md: string, host?: RunnableHost) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    extensions: [StarterKit, Markdown.configure({ marked: new Marked() as never }), ...(host ? [runnableCode(host)] : [])],
    content: md,
    contentType: "markdown",
  });
}

const settle = () => act(async () => new Promise((r) => setTimeout(r, 10)));
const view = (ed: Editor, i = 0) => ed.view.dom.querySelectorAll<HTMLElement>(".zr-runnable")[i]!;
const click = (root: HTMLElement, label: string) => act(async () => root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click());

const SOURCE = "Notes\n\n```python run id=a1\nx = 41\nx + 1\n```\n```output for=a1\n42\n```\n\nAfter";

describe("RunnableCode: Markdown", () => {
  it("reads RunnableCode with its Output and writes both back", () => {
    const ed = headless(SOURCE, fakeSandbox(echo).host);
    const nodes: Record<string, unknown>[] = [];
    ed.state.doc.descendants((n) => void (n.type.name === "runnableCode" && nodes.push({ ...n.attrs, code: n.textContent })));
    expect(nodes).toMatchObject([{ language: "python", runnableId: "a1", output: "42", code: "x = 41\nx + 1" }]);
    expect(ed.getMarkdown()).toBe(SOURCE);
    ed.destroy();
  });

  it("uses a longer fence when the code or Output contains backticks", () => {
    const md = "````javascript run id=b2\nconst s = `a ``` b`\n````";
    const ed = headless(md, fakeSandbox(echo).host);
    expect(ed.state.doc.firstChild!.textContent).toBe("const s = `a ``` b`");
    expect(ed.getMarkdown()).toBe(md);
    ed.destroy();
  });

  it("leaves code fences without `run`, and unknown languages, as plain code blocks", () => {
    const ed = headless("```python\nprint(1)\n```\n\n```rust run\nfn main(){}\n```", fakeSandbox(echo).host);
    const types: string[] = [];
    ed.state.doc.forEach((n) => void types.push(n.type.name));
    expect(types).toEqual(["codeBlock", "codeBlock"]);
    ed.destroy();
  });

  it("keeps RunnableCode and Output as plain code blocks, unchanged, when there is no Sandbox", () => {
    const ed = headless(SOURCE);
    const types: string[] = [];
    ed.state.doc.forEach((n) => void types.push(n.type.name));
    expect(types).toEqual(["paragraph", "codeBlock", "codeBlock", "paragraph"]);
    expect(ed.getMarkdown()).toContain("```python run id=a1\nx = 41\nx + 1\n```");
    expect(ed.getMarkdown()).toContain("```output for=a1\n42\n```");
    ed.destroy();
  });

  it("detects RunnableCode in Markdown", () => {
    expect(markdownHasRunnable(SOURCE)).toBe(true);
    expect(markdownHasRunnable("> ```js run id=x\n> 1\n> ```")).toBe(true);
    expect(markdownHasRunnable("```python\nrun()\n```")).toBe(false);
    expect(markdownHasRunnable("```python runner\n```")).toBe(false);
  });
});

describe("RunnableCode: running", () => {
  it("runs the code in the pad's Kernel and saves its Output", async () => {
    const sb = fakeSandbox(echo);
    const ed = headless("```python run id=c3\nprint('hi')\n```", sb.host);
    await click(view(ed), "Run");
    await settle();
    expect(sb.runs).toEqual([{ kernel: "pad:global#tab", runnableId: "c3", language: "python", code: "print('hi')", codeSource: "scratchpad" }]);
    expect(ed.getMarkdown().trimEnd()).toBe("```python run id=c3\nprint('hi')\n```\n```output for=c3\nran print('hi')\n```");
    expect(view(ed).querySelector(".zr-runnable-output")!.textContent).toContain("ran print('hi')");
    ed.destroy();
  });

  it("shows the last expression, stderr and errors, and saves them as text", async () => {
    const sb = fakeSandbox(() => [
      { type: "stdout", text: "a\n" },
      { type: "stderr", text: "warn\n" },
      { type: "result", text: "42" },
      { type: "error", name: "ValueError", message: "bad" },
      { type: "exit", ok: false, ms: 3 },
    ]);
    const ed = headless("```python run id=d4\nx\n```", sb.host);
    await click(view(ed), "Run");
    await settle();
    expect(ed.getMarkdown()).toContain("```output for=d4\na\nwarn\n42\nValueError: bad\n```");
    expect(view(ed).querySelectorAll(".zr-runnable-stderr")).toHaveLength(2);
    ed.destroy();
  });

  it("cuts long Output in the pad and marks the cut", async () => {
    const sb = fakeSandbox(() => [{ type: "stdout", text: "x".repeat(OUTPUT_LIMIT + 500) }, { type: "exit", ok: true, ms: 1 }]);
    const ed = headless("```python run id=e5\nbig()\n```", sb.host);
    await click(view(ed), "Run");
    await settle();
    let output = "";
    ed.state.doc.descendants((n) => void (n.type.name === "runnableCode" && (output = n.attrs.output)));
    expect(output.length).toBeLessThan(OUTPUT_LIMIT + 40);
    expect(output.endsWith(TRUNCATED_MARKER)).toBe(true);
    ed.destroy();
  });

  it("does not rewrite the pad when unchanged code gives the same Output", async () => {
    const sb = fakeSandbox(echo);
    const ed = headless("```python run id=f6\n1\n```\n```output for=f6\nran 1\n```", sb.host);
    let updates = 0;
    ed.on("update", () => updates++);
    await click(view(ed), "Run");
    await settle();
    expect(sb.runs).toHaveLength(1);
    expect(updates).toBe(0);
    ed.destroy();
  });

  it("marks the Output stale once the code changes", async () => {
    const sb = fakeSandbox(echo);
    const ed = headless("```python run id=g7\n1\n```\n```output for=g7\nran 1\n```", sb.host);
    expect(view(ed).dataset.stale).toBe("false");
    ed.commands.insertContentAt(ed.state.doc.firstChild!.nodeSize - 1, "+1");
    expect(ed.state.doc.firstChild!.textContent).toBe("1+1");
    expect(view(ed).dataset.stale).toBe("true");
    expect(ed.getMarkdown()).toContain("```output for=g7\nran 1\n```");
    ed.destroy();
  });

  it("runs with Shift+Enter inside the code", async () => {
    const sb = fakeSandbox(echo);
    const ed = headless("```javascript run id=h8\n2\n```", sb.host);
    ed.commands.setTextSelection(2);
    await act(async () => void ed.commands.keyboardShortcut("Shift-Enter"));
    await settle();
    expect(sb.runs.map((r) => r.language)).toEqual(["javascript"]);
    ed.destroy();
  });

  it("Stop restarts the Kernel and says its variables were cleared", async () => {
    const sb = fakeSandbox(() => [{ type: "stdout", text: "loop\n" }, { type: "restarted", reason: "stopped" }]);
    const ed = headless("```python run id=i9\nwhile True: pass\n```", sb.host);
    await click(view(ed), "Run");
    await settle();
    expect(view(ed).dataset.state).toBe("running");
    await click(view(ed), "Stop");
    await settle();
    expect(sb.restarts).toEqual(["pad:global#tab|python"]);
    expect(view(ed).dataset.state).toBe("idle");
    expect(view(ed).querySelector(".zr-runnable-notice")!.textContent).toBe("Kernel restarted, variables cleared.");
    expect(ed.getMarkdown()).toContain("```output for=i9\nloop\n```");
    expect(ed.getMarkdown()).not.toContain("cleared");
    ed.destroy();
  });

  it("can't run a language the Sandbox doesn't offer", () => {
    const ed = headless("```typescript run id=j0\nlet a: number = 1\n```", fakeSandbox(echo).host);
    expect(view(ed).querySelector<HTMLButtonElement>('button[aria-label="Run"]')!.disabled).toBe(true);
    expect(view(ed).querySelector(".zr-runnable-status")!.textContent).toBe("TypeScript isn't available here");
    ed.destroy();
  });
});

describe("RunnableCode: in the scratchpad", () => {
  const pad = { markdown: SOURCE, json: { type: "doc", content: [{ type: "runnableCode", attrs: { language: "python" } }] }, updatedAt: "" };

  it("ignores cached JSON with RunnableCode when there is no Sandbox", () => {
    const sandbox = { languages: ["python" as const], client: async () => fakeSandbox(echo).client, dispose() {} };
    expect(resolvePadFeatures({ mathLoader: null, sandbox: null, scope: { kind: "global" } }, PAD_FEATURES).contentFor(pad).contentType).toBe("markdown");
    expect(resolvePadFeatures({ mathLoader: null, sandbox, scope: { kind: "global" } }, PAD_FEATURES).contentFor(pad).contentType).toBe("json");
  });

  it("offers RunnableCode in the toolbar only when the provider has a Sandbox", async () => {
    const { ReaderProvider } = await import("../src/react/index");
    const { ScratchpadEditor } = await import("../src/editor/index");
    const store = createReaderStore({ adapter: createMemoryAdapter(), writeDelay: 0 });
    const scope = { kind: "book", bookId: "guide" } as const;
    store.savePad(scope, SOURCE);
    const fake = fakeSandbox(echo);
    let disposed = 0;
    const loader: SandboxLoader = { languages: ["python"], load: async () => ({ ...fake.client, dispose: () => void disposed++ }) };
    const mount = async (sandbox?: SandboxLoader) => {
      const el = document.createElement("div");
      document.body.appendChild(el);
      const root = createRoot(el);
      await act(async () => root.render(h(ReaderProvider, { store, sandbox, manageTheme: false, toaster: false, children: h(ScratchpadEditor, { scope }) })));
      await settle();
      return { el, root };
    };

    const on = await mount(loader);
    expect(on.el.querySelector('button[aria-label="Insert runnable code"]')).not.toBeNull();
    await click(on.el.querySelector(".zr-runnable")!, "Run");
    await settle();
    expect(fake.runs[0]!.kernel).toMatch(/^pad:book:guide#/);
    await act(async () => on.root.unmount());
    expect(disposed).toBe(1);

    const off = await mount();
    expect(off.el.querySelector('button[aria-label="Insert runnable code"]')).toBeNull();
    expect(off.el.querySelector(".zr-runnable")).toBeNull();
    expect(off.el.textContent).toContain("x = 41");
    await act(async () => off.root.unmount());
  });
});
