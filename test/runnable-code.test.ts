// @vitest-environment happy-dom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { Marked } from "marked";
import { describe, expect, it } from "vitest";
import { createMemoryAdapter, createMemoryBlobStore, createReaderStore, type RunEvent, type RunRequest, type SandboxClient, type SandboxLoader } from "../src/core/index";
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
      yield { type: "started" } as RunEvent;
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

  it("strips a fence's indent from the code, and pairs an Output with RunnableCode that has no id", () => {
    const ed = headless("  ```python run\n  x = 1\n    y = 2\n  ```\n```output\nok\n```", fakeSandbox(echo).host);
    const n = ed.state.doc.firstChild!;
    expect(n.type.name).toBe("runnableCode");
    expect(n.textContent).toBe("x = 1\n  y = 2");
    expect(n.attrs.output).toBe("ok");
    ed.destroy();
  });

  it("detects RunnableCode in Markdown", () => {
    expect(markdownHasRunnable("- ```python run id=x\n  1\n  ```")).toBe(true);
    expect(markdownHasRunnable("1. ```js run\n   1\n   ```")).toBe(true);
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
    // Blank lines at the end don't make it stale.
    ed.commands.setContent("```python run id=g7\n1\n\n\n```\n```output for=g7\nran 1\n```", { contentType: "markdown" });
    expect(view(ed).dataset.stale).toBe("false");
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

  it("Stop on code still waiting for the Kernel cancels it, and leaves the running code alone", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const runs: string[] = [];
    const restarts: string[] = [];
    const client: SandboxClient = {
      languages: ["python"],
      async *run(req, opts) {
        runs.push(req.code);
        if (req.code === "second") {
          // Queued behind the first run: never starts if cancelled.
          await new Promise<void>((r) => opts?.signal?.addEventListener("abort", () => r()));
          return;
        }
        yield { type: "started" };
        await gate;
        yield { type: "exit", ok: true, ms: 1 };
      },
      async restart(k) {
        restarts.push(k);
      },
      dispose() {},
    };
    const host: RunnableHost = { languages: ["python"], client: async () => client, kernel: "k", codeSource: "scratchpad" };
    const ed = headless("```python run id=q1\nfirst\n```\n\n```python run id=q2\nsecond\n```", host);
    await click(view(ed, 0), "Run");
    await click(view(ed, 1), "Run");
    await settle();
    expect(view(ed, 1).querySelector(".zr-runnable-status")!.textContent).toBe("Waiting for the Kernel…");
    await click(view(ed, 1), "Stop");
    await settle();
    expect(restarts).toEqual([]);
    expect(view(ed, 1).dataset.state).toBe("idle");
    expect(view(ed, 1).querySelector(".zr-runnable-notice")!.textContent).toBe("Stopped before it ran.");
    expect(view(ed, 0).dataset.state).toBe("running");
    release();
    await settle();
    expect(view(ed, 0).dataset.state).toBe("idle");
    ed.destroy();
  });

  it("offers only the Sandbox's languages in the picker", () => {
    const ed = headless("```python run id=l1\n1\n```", fakeSandbox(echo).host);
    expect([...view(ed).querySelectorAll("option")].map((o) => o.value)).toEqual(["python", "javascript"]);
    ed.destroy();
  });

  it("can't run a language the Sandbox doesn't offer", () => {
    const ed = headless("```typescript run id=j0\nlet a: number = 1\n```", fakeSandbox(echo).host);
    expect(view(ed).querySelector<HTMLButtonElement>('button[aria-label="Run"]')!.disabled).toBe(true);
    expect(view(ed).querySelector(".zr-runnable-status")!.textContent).toBe("TypeScript isn't available here");
    ed.destroy();
  });
});

const ALL = { global: "browser", book: "browser", chapter: "browser" } as const;

describe("RunnableCode: in the scratchpad", () => {
  const pad = { markdown: SOURCE, json: { type: "doc", content: [{ type: "runnableCode", attrs: { language: "python" } }] }, updatedAt: "" };

  it("ignores cached JSON with RunnableCode when there is no Sandbox", () => {
    const sandbox = { languages: ["python" as const], client: async () => fakeSandbox(echo).client, dispose() {} };
    expect(resolvePadFeatures({ mathLoader: null, sandbox: null, sandboxScopes: ALL, scope: { kind: "global" } }, PAD_FEATURES).contentFor(pad).contentType).toBe("markdown");
    expect(resolvePadFeatures({ mathLoader: null, sandbox, sandboxScopes: ALL, scope: { kind: "global" } }, PAD_FEATURES).contentFor(pad).contentType).toBe("json");
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

  it("still runs after React Strict Mode remounts the provider", async () => {
    const { StrictMode } = await import("react");
    const { ReaderProvider } = await import("../src/react/index");
    const { ScratchpadEditor } = await import("../src/editor/index");
    const store = createReaderStore({ adapter: createMemoryAdapter(), writeDelay: 0 });
    const scope = { kind: "book", bookId: "strict" } as const;
    store.savePad(scope, "```python run id=s1\n1\n```");
    const fake = fakeSandbox(echo);
    const loader: SandboxLoader = { languages: ["python"], load: async () => fake.client };
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => root.render(h(StrictMode, null, h(ReaderProvider, { store, sandbox: loader, manageTheme: false, toaster: false, children: h(ScratchpadEditor, { scope }) }))));
    await settle();
    await click(el.querySelector(".zr-runnable")!, "Run");
    await settle();
    expect(fake.runs).toHaveLength(1);
    expect(el.querySelector(".zr-runnable-output")!.textContent).toContain("ran 1");
    await act(async () => root.unmount());
  });

  it("follows the site's limits: scopes turned off show plain code, and the Kernel gets the timeouts", async () => {
    const { ReaderProvider } = await import("../src/react/index");
    const { ScratchpadEditor } = await import("../src/editor/index");
    const store = createReaderStore({ adapter: createMemoryAdapter(), writeDelay: 0 });
    const fake = fakeSandbox(echo);
    const settings: unknown[] = [];
    const loader: SandboxLoader = { languages: ["python"], load: async (s) => (settings.push(s), fake.client) };
    const options = { sandbox: { scopes: { global: false as const }, kernel: { idleTimeoutMs: 0, runTimeoutMs: 5000 } } };
    const mount = async (scope: { kind: "global" } | { kind: "book"; bookId: string }) => {
      store.savePad(scope, SOURCE);
      const el = document.createElement("div");
      document.body.appendChild(el);
      const root = createRoot(el);
      await act(async () => root.render(h(ReaderProvider, { store, sandbox: loader, options, manageTheme: false, toaster: false, children: h(ScratchpadEditor, { scope }) })));
      await settle();
      return { el, root };
    };

    const global = await mount({ kind: "global" });
    expect(global.el.querySelector(".zr-runnable")).toBeNull();
    expect(global.el.querySelector('button[aria-label="Insert runnable code"]')).toBeNull();
    expect(global.el.textContent).toContain("x = 41");
    await act(async () => global.root.unmount());

    const book = await mount({ kind: "book", bookId: "guide" });
    await click(book.el.querySelector(".zr-runnable")!, "Run");
    await settle();
    expect(settings).toEqual([{ idleTimeoutMs: 0, runTimeoutMs: 5000, permissions: { scratchpad: { dangerousPermissions: {} } } }]);
    await act(async () => book.root.unmount());
  });
});

describe("RunnableCode: images", () => {
  // A 1×1 PNG.
  const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const plot = () => [{ type: "stdout", text: "plotted\n" }, { type: "display", mime: "image/png", data: PNG }, { type: "exit", ok: true, ms: 1 }] as RunEvent[];

  it("keeps displayed images in the BlobStore and refers to them from the pad", async () => {
    const blobs = createMemoryBlobStore();
    const sb = fakeSandbox(plot);
    const host = { ...sb.host, blobs, addImage: async (b: Blob) => `zr-blob:${await blobs.put(b)}` };
    const ed = headless("```python run id=p1\nplt.plot([1, 2])\n```", host);
    await click(view(ed), "Run");
    await settle();
    const [stored] = await blobs.list();
    expect(stored).toBeDefined();
    const md = ed.getMarkdown();
    expect(md).toContain(`\`\`\`output for=p1\nplotted\n\`\`\`\n![output](zr-blob:${stored!.id})`);
    expect(md).not.toContain(PNG);
    expect(JSON.stringify(ed.getJSON())).not.toContain(PNG);
    expect(view(ed).querySelectorAll("img.zr-runnable-display")).toHaveLength(1);

    // Reloading the pad brings the image back; running again with the same plot leaves the pad alone.
    const again = headless(md, host);
    expect(again.getMarkdown()).toBe(md);
    let updates = 0;
    again.on("update", () => updates++);
    await click(view(again), "Run");
    await settle();
    expect(updates).toBe(0);
    expect(view(again).querySelectorAll("img.zr-runnable-display")).toHaveLength(1);
    ed.destroy();
    again.destroy();
  });

  it("drops the old image reference when a run replaces it", async () => {
    const blobs = createMemoryBlobStore();
    let text = "first";
    const sb = fakeSandbox(() => [{ type: "stdout", text }, { type: "exit", ok: true, ms: 1 }]);
    const host = { ...sb.host, blobs, addImage: async (b: Blob) => `zr-blob:${await blobs.put(b)}` };
    const ed = headless("```python run id=p2\nx\n```\n```output for=p2\nold\n```\n![output](zr-blob:abc123)", host);
    text = "new";
    await click(view(ed), "Run");
    await settle();
    expect(ed.getMarkdown()).not.toContain("zr-blob:abc123");
    ed.destroy();
  });

  it("never shows or keeps SVG from a run", async () => {
    const blobs = createMemoryBlobStore();
    const sb = fakeSandbox(() => [{ type: "display", mime: "image/svg+xml", data: btoa("<svg onload='alert(1)'/>") }, { type: "exit", ok: true, ms: 1 }]);
    const ed = headless("```python run id=p4\nsvg()\n```", { ...sb.host, blobs, addImage: async (b: Blob) => `zr-blob:${await blobs.put(b)}` });
    await click(view(ed), "Run");
    await settle();
    expect(await blobs.list()).toEqual([]);
    expect(view(ed).querySelectorAll("img")).toHaveLength(0);
    ed.destroy();
  });

  it("shows images without a store, and says they weren't kept", async () => {
    const sb = fakeSandbox(plot);
    const ed = headless("```python run id=p3\nplot()\n```", sb.host);
    await click(view(ed), "Run");
    await settle();
    expect(view(ed).querySelectorAll("img.zr-runnable-display")).toHaveLength(1);
    expect(view(ed).querySelector(".zr-runnable-notice")!.textContent).toContain("aren't kept");
    expect(ed.getMarkdown()).not.toContain("![output]");
    ed.destroy();
  });
});
