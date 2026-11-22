/**
 * RunnableCode in chapters: the browser turns each marked `pre`
 * (`data-zr-runnable`, from the content pipeline) into code the reader can run.
 * The author's code and Output stay in the page untouched; the controls, the
 * editor and the reader's Output live in one `data-zr-ignore` element after the
 * code, so highlighting never sees them. Editing hides the author's code (and
 * so its highlights) until Reset. Nothing here is saved: edits and Output last
 * as long as the page.
 */
import { useEffect, useRef } from "react";
import {
  IGNORE_ATTR,
  LANGUAGE_LABELS,
  RESTART_NOTICE,
  TAB_ID,
  base64ToBlob,
  isRaster,
  newRunnableId,
  outputText,
  renderRunnableMarkdown,
  codeFingerprint,
  sandboxLanguage,
  truncateOutput,
  type RunEvent,
  type SandboxConnection,
  type SandboxLanguage,
} from "zreader";
import { useReader, useSandbox } from "./context";

export interface ChapterRunnableOptions {
  sandbox: SandboxConnection;
  /** The chapter page's Kernel identity (one Kernel per language). */
  kernel: string;
  /** Appends Markdown to the reader's chapter pad. Without it, there's no Copy to scratchpad. */
  copyToPad?: (markdown: string) => void;
}

let visits = 0;

/**
 * One Kernel per chapter page and tab, apart from every pad's. Each visit of the
 * page gets its own, so ending the last visit's Kernels can't hit the new ones.
 */
export function chapterKernel(bookId: string, chapterId: string): string {
  return `page:${encodeURIComponent(bookId)}:${encodeURIComponent(chapterId)}#${TAB_ID}~${++visits}`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: (Node | string)[]) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith("data-") || k.startsWith("aria-") || k === "role") node.setAttribute(k, String(v));
    else (node as unknown as Record<string, unknown>)[k] = v;
  }
  node.append(...children);
  return node;
}

const button = (label: string, text = label, title?: string) =>
  el("button", { type: "button", className: "zr-chapter-runnable-button", textContent: text, "aria-label": label, ...(title ? { title } : {}) });

/** The code of a marked `pre`, without the newline a fence ends with. */
function codeOf(pre: HTMLElement): string {
  return (pre.querySelector("code") ?? pre).textContent!.replace(/\n$/, "");
}

/** The author's Output fence for `id`: the next element after the code. */
function authorOutput(pre: HTMLElement, id: string): HTMLElement | null {
  const next = pre.nextElementSibling as HTMLElement | null;
  return next?.tagName === "PRE" && next.getAttribute("data-zr-output-for") === id ? next : null;
}

function enhance(pre: HTMLElement, language: SandboxLanguage, opts: ChapterRunnableOptions, used: Set<SandboxLanguage>) {
  const id = pre.getAttribute("data-zr-runnable-id") ?? "";
  const author = codeOf(pre);
  const authorOut = authorOutput(pre, id);
  const authorOutText = authorOut ? codeOf(authorOut) : null;

  let running: { abort: AbortController; started: boolean; cancelled: boolean } | null = null;
  let editing = false;
  /** The last run's Output, with the code it came from: copied only together. */
  let lastOutput: { text: string; ranFor: string } | null = null;
  let urls: string[] = [];

  const status = el("span", { className: "zr-chapter-runnable-status", role: "status" });
  const run = button("Run", "Run", "Run (Shift+Enter)");
  const stop = button("Stop");
  const restart = button("Restart Kernel", "Restart", "Restart the Kernel (clears variables)");
  const edit = button("Edit code", "Edit");
  const reset = button("Reset to the author's code", "Reset");
  const copy = opts.copyToPad ? button("Copy to pad", "Copy to pad", "Copy the code and its Output to this chapter's scratchpad") : null;
  const bar = el(
    "div",
    { className: "zr-chapter-runnable-bar" },
    el("span", { className: "zr-chapter-runnable-language", textContent: LANGUAGE_LABELS[language] }),
    status,
    edit,
    reset,
    ...(copy ? [copy] : []),
    run,
    stop,
    restart,
  );
  const editor = el("textarea", {
    className: "zr-chapter-runnable-editor",
    spellcheck: false,
    hidden: true,
    "aria-label": `${LANGUAGE_LABELS[language]} code (Shift+Enter runs it)`,
  });
  const text = el("pre", { className: "zr-chapter-runnable-output-text" });
  const images = el("div", { className: "zr-chapter-runnable-images" });
  const notice = el("p", { className: "zr-chapter-runnable-notice" });
  const output = el("div", { className: "zr-chapter-runnable-output", hidden: true, "aria-live": "polite", "aria-label": "Output" }, text, images, notice);
  const host = el("div", { className: "zr-chapter-runnable", [IGNORE_ATTR]: "", "data-state": "idle" }, bar, editor, output);
  pre.after(host);
  pre.classList.add("zr-chapter-runnable-code");

  const code = () => (editing ? editor.value : author);
  const controls = () => {
    // Keep keyboard focus when the button that has it is about to hide.
    const focused = document.activeElement;
    const moveTo = focused === run && running ? stop : focused === stop && !running ? run : null;
    host.dataset.state = running ? "running" : "idle";
    host.dataset.edited = editing && editor.value !== author ? "true" : "false";
    run.hidden = !!running;
    stop.hidden = !running;
    restart.hidden = !!running;
    edit.hidden = editing;
    reset.hidden = !editing;
    editor.disabled = !!running;
    moveTo?.focus();
  };
  const freeImages = () => {
    for (const u of urls) URL.revokeObjectURL(u);
    urls = [];
    images.replaceChildren();
  };
  const show = (events: readonly RunEvent[], note = "") => {
    text.replaceChildren();
    freeImages();
    for (const e of events) {
      if (e.type === "stdout") text.append(e.text);
      else if (e.type === "stderr") text.append(el("span", { className: "zr-chapter-runnable-stderr" }, e.text));
      else if (e.type === "result") text.append(el("span", { className: "zr-chapter-runnable-result" }, `${e.text}\n`));
      else if (e.type === "error") text.append(el("span", { className: "zr-chapter-runnable-stderr" }, `${e.traceback ?? `${e.name}: ${e.message}`}\n`));
      else if (e.type === "display" && isRaster(e.mime)) {
        const url = URL.createObjectURL(base64ToBlob(e.data, e.mime));
        urls.push(url);
        images.append(el("img", { className: "zr-chapter-runnable-image", src: url, alt: "Output image" }));
      }
    }
    notice.textContent = note;
    output.hidden = !text.textContent && !images.childElementCount && !note;
  };

  const runCode = async () => {
    if (running) return;
    const self = { abort: new AbortController(), started: false, cancelled: false };
    running = self;
    const source = code();
    used.add(language);
    const events: RunEvent[] = [];
    const t0 = performance.now();
    let restarted: string | null = null;
    let ok = false;
    status.textContent = "Waiting for the Kernel…";
    // The reader's Output replaces the author's from the first run on.
    if (authorOut) authorOut.hidden = true;
    controls();
    show(events);
    try {
      const client = await opts.sandbox.client();
      const stream = client.run({ kernel: opts.kernel, runnableId: id, language, code: source, codeSource: "chapter" }, { signal: self.abort.signal });
      for await (const e of stream) {
        if (self.abort.signal.aborted) break;
        if (e.type === "status") status.textContent = e.text;
        else if (e.type === "started") {
          self.started = true;
          status.textContent = "Running…";
        } else {
          if (e.type === "restarted") restarted = e.reason;
          if (e.type === "exit") ok = e.ok;
          events.push(e);
          show(events);
        }
      }
    } catch (err) {
      events.push({ type: "error", name: "SandboxError", message: (err as Error)?.message ?? String(err) });
    } finally {
      if (running === self) running = null;
    }
    if (!host.isConnected) return;
    if (self.cancelled) {
      status.textContent = "";
      show(events, "Stopped before it ran.");
      return controls();
    }
    lastOutput = { text: truncateOutput(outputText(events)), ranFor: codeFingerprint(language, source) };
    show(events, restarted ? (RESTART_NOTICE[restarted] ?? RESTART_NOTICE.stopped!) : "");
    status.textContent = restarted ? "" : `${ok ? "Done" : "Failed"} in ${Math.round(performance.now() - t0)} ms`;
    controls();
  };

  const restartKernel = async () => {
    try {
      await (await opts.sandbox.client()).restart(opts.kernel, language);
      if (!running) show([], RESTART_NOTICE.stopped!);
    } catch {
      /* nothing to restart */
    }
  };

  const onStop = () => {
    if (running && !running.started) {
      running.cancelled = true;
      running.abort.abort();
    } else void restartKernel();
  };
  const onEdit = () => {
    editing = true;
    editor.value = author;
    editor.rows = Math.min(30, Math.max(3, author.split("\n").length + 1));
    editor.hidden = false;
    // Highlights stay on the author's code, so it's hidden while the reader edits.
    pre.hidden = true;
    controls();
    editor.focus();
  };
  const onReset = () => {
    editing = false;
    editor.hidden = true;
    pre.hidden = false;
    controls();
  };
  const onCopy = () => {
    const current = code();
    const fp = codeFingerprint(language, current);
    // An Output goes with the code that produced it, or none at all.
    const output = lastOutput?.ranFor === fp ? lastOutput.text : fp === codeFingerprint(language, author) ? authorOutText : null;
    opts.copyToPad?.(renderRunnableMarkdown({ language, runnableId: newRunnableId(), output: output || null }, current));
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" && e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      void runCode();
    }
  };

  run.addEventListener("click", () => void runCode());
  stop.addEventListener("click", onStop);
  restart.addEventListener("click", () => void restartKernel());
  edit.addEventListener("click", onEdit);
  reset.addEventListener("click", onReset);
  copy?.addEventListener("click", onCopy);
  editor.addEventListener("input", controls);
  editor.addEventListener("keydown", onKey);
  controls();

  return () => {
    running?.abort.abort();
    running = null;
    freeImages();
    host.remove();
    pre.hidden = false;
    pre.classList.remove("zr-chapter-runnable-code");
    if (!pre.classList.length) pre.removeAttribute("class");
    if (authorOut) authorOut.hidden = false;
  };
}

/**
 * Makes the RunnableCode in `root` runnable with `opts.sandbox`. Languages the
 * Sandbox doesn't run stay plain code. Returns a cleanup that removes the
 * controls and ends the page's Kernels.
 */
export function enhanceChapterRunnables(root: HTMLElement, opts: ChapterRunnableOptions): () => void {
  const used = new Set<SandboxLanguage>();
  const cleanups: Array<() => void> = [];
  for (const pre of root.querySelectorAll<HTMLElement>("pre[data-zr-runnable]")) {
    const language = sandboxLanguage(pre.getAttribute("data-zr-runnable"));
    if (!language || !opts.sandbox.languages.includes(language)) continue;
    cleanups.push(enhance(pre, language, opts, used));
  }
  return () => {
    for (const c of cleanups) c();
    if (!used.size) return;
    // Leaving the page ends its Kernels.
    void opts.sandbox.client().then(
      (client) => Promise.all([...used].map((l) => client.restart(opts.kernel, l))),
      () => {},
    );
  };
}

export interface UseChapterRunnablesOptions {
  bookId: string;
  chapterId: string;
  /** Changes whenever the chapter's content does (the HTML string, or the content hash). */
  contentKey?: unknown;
  copyToPad?: (markdown: string) => void;
}

/** RunnableCode in a rendered chapter, when the provider has a Sandbox and `reader.sandbox.chapters` allows it. */
export function useChapterRunnables(root: HTMLElement | null, { bookId, chapterId, contentKey, copyToPad }: UseChapterRunnablesOptions) {
  const sandbox = useSandbox();
  const { options } = useReader();
  const on = options.sandbox.chapters === "browser";
  const copyRef = useRef(copyToPad);
  copyRef.current = copyToPad;
  const canCopy = !!copyToPad;
  useEffect(() => {
    if (!root || !sandbox || !on) return;
    return enhanceChapterRunnables(root, {
      sandbox,
      kernel: chapterKernel(bookId, chapterId),
      copyToPad: canCopy ? (md) => copyRef.current?.(md) : undefined,
    });
  }, [root, sandbox, on, bookId, chapterId, contentKey, canCopy]);
}
