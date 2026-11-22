/**
 * RunnableCode in the scratchpad: a code block the reader can run in a Sandbox,
 * shown with the Output of its last run. Stored in the pad's Markdown as
 *
 *   ```python run id=k3x9
 *   x = 41; x + 1
 *   ```
 *   ```output for=k3x9
 *   42
 *   ```
 *   ![output](zr-blob:9f2c…)
 *
 * Images a run displays (plots) are kept in the BlobStore and listed after the
 * Output fence, so records never hold binary data.
 * The Output fence holds only what the last run printed (ADR 0002): no status
 * or timing, so running unchanged code does not rewrite the pad. Without a
 * Sandbox the extension is off and both fences read as plain code blocks.
 */
import { Node as TiptapNode, mergeAttributes, type Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { SANDBOX_LANGUAGES, base64ToBlob, parseBlobUrl, type BlobStore, type CodeSource, type RunEvent, type SandboxClient, type SandboxLanguage } from "zreader";

export const RUNNABLE_NODE = "runnableCode";

/** Output longer than this is cut in the pad, with a marker. */
export const OUTPUT_LIMIT = 8000;
export const TRUNCATED_MARKER = "… [output truncated]";

const LANGUAGE_ALIASES: Record<string, SandboxLanguage> = {
  python: "python",
  py: "python",
  javascript: "javascript",
  js: "javascript",
  typescript: "typescript",
  ts: "typescript",
};

export const LANGUAGE_LABELS: Record<SandboxLanguage, string> = { python: "Python", javascript: "JavaScript", typescript: "TypeScript" };

/** What the RunnableCode nodes of one pad run against. */
export interface RunnableHost {
  languages: readonly SandboxLanguage[];
  client(): Promise<SandboxClient>;
  /** The Kernel identity for this pad in this tab. */
  kernel: string;
  codeSource: CodeSource;
  /** Stores an image a run displayed and returns its `zr-blob:` src. Without it, images show but aren't kept. */
  addImage?(image: Blob): Promise<string>;
  /** Resolves kept images for display. */
  blobs?: BlobStore;
}

export interface RunnableAttrs {
  language: SandboxLanguage;
  runnableId: string;
  /** Text of the last run, or `null` before the first run. */
  output: string | null;
  /** Fingerprint of the language and code that produced `output` (cached JSON only). */
  outputFor: string | null;
  /** Images the last run displayed, as `zr-blob:` srcs. */
  displays: string[];
}

// ------------------------------------------------------------------ Markdown

/** FNV-1a fingerprint of a piece of RunnableCode, used to tell when its Output is stale. */
export function codeFingerprint(language: string, code: string): string {
  let h = 0x811c9dc5;
  // Trailing blank lines don't change what the code does.
  const s = `${language}\n${code.replace(/\s+$/, "")}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function newRunnableId(): string {
  return Math.random().toString(36).slice(2, 8).padEnd(6, "0");
}

/** Cuts Output to `OUTPUT_LIMIT` characters, marking the cut. */
export function truncateOutput(text: string): string {
  if (text.length <= OUTPUT_LIMIT) return text;
  return `${text.slice(0, OUTPUT_LIMIT).replace(/\n?$/, "\n")}${TRUNCATED_MARKER}`;
}

export interface RunnableToken {
  type: typeof RUNNABLE_NODE;
  raw: string;
  language: SandboxLanguage;
  runnableId: string;
  code: string;
  output: string | null;
  displays: string[];
}

const DISPLAY_LINE = /^!\[output\]\((zr-blob:[a-z0-9_-]+)\)[ \t]*$/i;

const OPEN = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`]+)([^\n`]*)$/;

interface Fence {
  info: string;
  rest: string;
  body: string;
  /** Lines consumed, including both fences. */
  lines: number;
}

/** Reads one fenced block starting at `lines[at]`, or `null`. */
function readFence(lines: string[], at: number): Fence | null {
  const m = OPEN.exec(lines[at] ?? "");
  if (!m) return null;
  const fence = m[1]!;
  const close = new RegExp(`^ {0,3}${fence[0] === "`" ? "`" : "~"}{${fence.length},}[ \\t]*$`);
  const body: string[] = [];
  for (let i = at + 1; i < lines.length; i++) {
    if (close.test(lines[i]!)) return { info: m[2]!, rest: m[3]!, body: body.join("\n"), lines: i - at + 1 };
    body.push(lines[i]!);
  }
  return null; // unclosed: leave it to the regular code block
}

const attr = (rest: string, name: string) => new RegExp(`(?:^|\\s)${name}=([^\\s]+)`).exec(rest)?.[1];

/** Tokenizes RunnableCode (and the Output fence right after it) at the start of `src`. */
export function tokenizeRunnable(src: string): RunnableToken | undefined {
  const lines = src.split("\n");
  const code = readFence(lines, 0);
  if (!code) return undefined;
  const language = LANGUAGE_ALIASES[code.info.toLowerCase()];
  if (!language || !/(?:^|\s)run(?:\s|$)/.test(code.rest)) return undefined;
  const runnableId = attr(code.rest, "id") ?? newRunnableId();
  let used = code.lines;
  let output: string | null = null;
  let blank = 0;
  while (used + blank < lines.length && lines[used + blank]!.trim() === "") blank++;
  const out = readFence(lines, used + blank);
  if (out && out.info === "output" && attr(out.rest, "for") === runnableId) {
    output = out.body;
    used += blank + out.lines;
  }
  const displays: string[] = [];
  for (;;) {
    blank = 0;
    while (used + blank < lines.length && lines[used + blank]!.trim() === "" && blank < 1) blank++;
    const m = DISPLAY_LINE.exec(lines[used + blank] ?? "");
    if (!m) break;
    displays.push(m[1]!);
    used += blank + 1;
  }
  const raw = lines.slice(0, used).join("\n") + (used < lines.length ? "\n" : "");
  return { type: RUNNABLE_NODE, raw, language, runnableId, code: code.body, output, displays };
}

/** A backtick fence longer than any run of backticks in `text`. */
function fenceFor(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((r) => r.length));
  return "`".repeat(Math.max(3, longest + 1));
}

export function renderRunnableMarkdown(attrs: Pick<RunnableAttrs, "language" | "runnableId" | "output"> & { displays?: string[] | null }, code: string): string {
  const f = fenceFor(code);
  const parts = [`${f}${attrs.language} run id=${attrs.runnableId}`, ...(code ? [code] : []), f];
  if (attrs.output) {
    const o = fenceFor(attrs.output);
    parts.push(`${o}output for=${attrs.runnableId}`, attrs.output, o);
  }
  for (const src of attrs.displays ?? []) parts.push(`![output](${src})`);
  return parts.join("\n");
}

/** Would this Markdown parse into RunnableCode when the feature is on? */
export function markdownHasRunnable(markdown: string): boolean {
  return /^(?:[ \t]*>)*[ \t]*(?:`{3,}|~{3,})[ \t]*(?:python|py|javascript|js|typescript|ts)[ \t]+(?:[^\n]*[ \t])?run(?:[ \t]|$)/im.test(markdown);
}

// ------------------------------------------------------------------ Running

/** Folds a run's events into the text saved as its Output. */
export function outputText(events: readonly RunEvent[]): string {
  let out = "";
  for (const e of events) {
    if (e.type === "stdout" || e.type === "stderr") out += e.text;
    else if (e.type === "result") out += (out && !out.endsWith("\n") ? "\n" : "") + e.text + "\n";
    else if (e.type === "error") out += (out && !out.endsWith("\n") ? "\n" : "") + (e.traceback ?? `${e.name}: ${e.message}`) + "\n";
  }
  return out.replace(/\n+$/, "");
}

const RESTART_NOTICE: Record<string, string> = {
  stopped: "Kernel restarted, variables cleared.",
  timeout: "The run took too long and was stopped. Kernel restarted, variables cleared.",
  idle: "The Kernel was idle and shut down. Kernel restarted, variables cleared.",
  crashed: "The Kernel stopped unexpectedly. Kernel restarted, variables cleared.",
};

export const RUN_EVENT = "zr-runnable-run";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & Record<string, unknown> = {}, ...children: (Node | string)[]) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith("data-") || k.startsWith("aria-") || k === "role") node.setAttribute(k, String(v));
    else (node as unknown as Record<string, unknown>)[k] = v;
  }
  node.append(...children);
  return node;
}

function nodeView(host: RunnableHost) {
  return ({ node: initial, getPos, editor }: { node: PMNode; getPos: () => number | undefined; editor: Editor }) => {
    let node = initial;
    let running: { abort: AbortController; events: RunEvent[] } | null = null;
    /** The last run's events, shown (with stderr styling) while the saved Output is still theirs. */
    let shown: { events: RunEvent[]; ranFor: string } | null = null;
    let notice = "";

    const attrs = () => node.attrs as RunnableAttrs;
    const language = el("select", { className: "zr-runnable-language", "aria-label": "Language" });
    for (const l of SANDBOX_LANGUAGES) language.append(el("option", { value: l, textContent: LANGUAGE_LABELS[l] }));
    const status = el("span", { className: "zr-runnable-status", role: "status" });
    const runButton = el("button", { type: "button", className: "zr-runnable-button", textContent: "Run", title: "Run (Shift+Enter)", "aria-label": "Run" });
    const stopButton = el("button", { type: "button", className: "zr-runnable-button", textContent: "Stop", "aria-label": "Stop" });
    const restartButton = el("button", { type: "button", className: "zr-runnable-button", textContent: "Restart", title: "Restart the Kernel (clears variables)", "aria-label": "Restart Kernel" });
    const bar = el("div", { className: "zr-runnable-bar", contentEditable: "false" }, language, status, runButton, stopButton, restartButton);
    const code = el("code");
    const pre = el("pre", { className: "zr-runnable-code", spellcheck: false }, code);
    const outputText_ = el("pre", { className: "zr-runnable-output-text" });
    const noticeEl = el("p", { className: "zr-runnable-notice" });
    const images = el("div", { className: "zr-runnable-displays" });
    const output = el("div", { className: "zr-runnable-output", contentEditable: "false", "aria-live": "polite", "aria-label": "Output" }, outputText_, images, noticeEl);
    /** Object URLs in the Output pane: kept images (released to the BlobStore) or live ones (revoked). */
    let shownImages: Array<{ src: string; url?: string; live: boolean }> = [];
    const showImages = (list: Array<{ src: string; live?: Blob }>) => {
      const key = list.map((i) => i.src).join(" ");
      if (key === shownImages.map((i) => i.src).join(" ")) return;
      for (const i of shownImages) {
        if (i.live && i.url) URL.revokeObjectURL(i.url);
        else if (!i.live) {
          const id = parseBlobUrl(i.src);
          if (id) host.blobs?.release(id);
        }
      }
      images.replaceChildren();
      shownImages = list.map(({ src, live }) => {
        const img = el("img", { className: "zr-runnable-display", alt: "Output image" });
        images.append(img);
        if (live) {
          const url = URL.createObjectURL(live);
          img.src = url;
          return { src, url, live: true };
        }
        const id = parseBlobUrl(src);
        if (id && host.blobs) void host.blobs.url(id).then((u) => (u ? (img.src = u) : (img.dataset.state = "missing")));
        return { src, live: false };
      });
    };
    const dom = el("div", { className: "zr-runnable", "data-runnable": "" }, bar, pre, output);

    const fingerprint = () => codeFingerprint(attrs().language, node.textContent);
    const supported = () => host.languages.includes(attrs().language);

    const renderOutput = () => {
      outputText_.replaceChildren();
      const live = running?.events ?? (shown && shown.ranFor === attrs().outputFor ? shown.events : undefined);
      if (live) {
        for (const e of live) {
          if (e.type === "stdout") outputText_.append(e.text);
          else if (e.type === "stderr") outputText_.append(el("span", { className: "zr-runnable-stderr" }, e.text));
          else if (e.type === "result") outputText_.append(el("span", { className: "zr-runnable-result" }, e.text + "\n"));
          else if (e.type === "error") outputText_.append(el("span", { className: "zr-runnable-stderr" }, (e.traceback ?? `${e.name}: ${e.message}`) + "\n"));
        }
      } else if (attrs().output) {
        outputText_.textContent = attrs().output;
      }
      const liveImages = (events: readonly RunEvent[]) =>
        events.flatMap((e, i) => (e.type === "display" && e.mime.startsWith("image/") ? [{ src: `live:${i}:${e.data.length}`, live: base64ToBlob(e.data, e.mime) }] : []));
      const kept = attrs().displays ?? [];
      if (running) showImages(liveImages(running.events));
      else if (kept.length) showImages(kept.map((src) => ({ src })));
      else showImages(live ? liveImages(live) : []);
      noticeEl.textContent = notice;
      const empty = !outputText_.textContent && !notice && !shownImages.length;
      output.hidden = empty;
      dom.dataset.stale = !running && attrs().output != null && attrs().outputFor !== fingerprint() ? "true" : "false";
    };

    const renderControls = () => {
      language.value = attrs().language;
      language.disabled = !!running || !editor.isEditable;
      runButton.hidden = !!running;
      runButton.disabled = !supported();
      stopButton.hidden = !running;
      restartButton.hidden = !!running;
      restartButton.disabled = !supported();
      dom.dataset.state = running ? "running" : "idle";
      if (!running) status.textContent = supported() ? (dom.dataset.stale === "true" ? "Output is from an older version of this code" : "") : `${LANGUAGE_LABELS[attrs().language]} isn't available here`;
    };

    const save = (text: string, ranFor: string, displays: string[]) => {
      const pos = getPos();
      if (typeof pos !== "number" || editor.isDestroyed) return;
      const current = editor.state.doc.nodeAt(pos);
      if (!current || current.type.name !== RUNNABLE_NODE) return;
      const has = !!text || displays.length > 0;
      const next = { output: text ? truncateOutput(text) : null, outputFor: has ? ranFor : null, displays };
      // Same Output from the same code: leave the pad untouched.
      const same = (a: string[] = [], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
      if (current.attrs.output === next.output && current.attrs.outputFor === next.outputFor && same(current.attrs.displays, displays)) return;
      editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, ...next }).setMeta("addToHistory", false));
    };

    const run = async () => {
      if (running || !supported()) return;
      const abort = new AbortController();
      const events: RunEvent[] = [];
      running = { abort, events };
      notice = "";
      const lang = attrs().language;
      const source = node.textContent;
      const ranFor = codeFingerprint(lang, source);
      const started = performance.now();
      status.textContent = "Running…";
      renderControls();
      renderOutput();
      let restarted: string | null = null;
      let ok = false;
      try {
        const client = await host.client();
        const stream = client.run({ kernel: host.kernel, runnableId: attrs().runnableId, language: lang, code: source, codeSource: host.codeSource }, { signal: abort.signal });
        for await (const e of stream) {
          if (abort.signal.aborted) return;
          if (e.type === "status") {
            status.textContent = e.text;
            continue;
          }
          if (e.type === "restarted") restarted = e.reason;
          if (e.type === "exit") ok = e.ok;
          events.push(e);
          renderOutput();
        }
      } catch (err) {
        events.push({ type: "error", name: "SandboxError", message: (err as Error)?.message ?? String(err) });
      } finally {
        if (running?.abort === abort) running = null;
      }
      if (abort.signal.aborted) return;
      notice = restarted ? (RESTART_NOTICE[restarted] ?? RESTART_NOTICE.stopped!) : "";
      // Keep displayed images in the BlobStore; the pad refers to them by id.
      const displays: string[] = [];
      for (const e of events) {
        if (e.type !== "display" || !e.mime.startsWith("image/")) continue;
        if (!host.addImage) {
          notice = [notice, "Images from this run aren't kept in the pad."].filter(Boolean).join(" ");
          break;
        }
        try {
          displays.push(await host.addImage(base64ToBlob(e.data, e.mime)));
        } catch (err) {
          notice = [notice, `An image wasn't kept: ${(err as Error)?.message ?? err}`].filter(Boolean).join(" ");
        }
      }
      shown = { events, ranFor };
      save(outputText(events), ranFor, displays);
      renderOutput();
      renderControls();
      if (!restarted) status.textContent = `${ok ? "Done" : "Failed"} in ${Math.round(performance.now() - started)} ms`;
    };

    const restart = async () => {
      try {
        const client = await host.client();
        await client.restart(host.kernel, attrs().language);
        if (!running) {
          notice = RESTART_NOTICE.stopped!;
          renderOutput();
        }
      } catch {
        /* nothing to restart */
      }
    };

    language.addEventListener("change", () => {
      const pos = getPos();
      if (typeof pos !== "number") return;
      editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, language: language.value }));
    });
    runButton.addEventListener("click", () => void run());
    stopButton.addEventListener("click", () => void restart());
    restartButton.addEventListener("click", () => void restart());
    dom.addEventListener(RUN_EVENT, () => void run());

    renderOutput();
    renderControls();

    return {
      dom,
      contentDOM: code,
      update(next: PMNode) {
        if (next.type !== node.type) return false;
        node = next;
        if (!running) renderOutput();
        renderControls();
        return true;
      },
      stopEvent: (e: Event) => !code.contains(e.target as globalThis.Node),
      ignoreMutation: (m: MutationRecord | { type: "selection"; target: globalThis.Node }) => m.type !== "selection" && !code.contains(m.target),
      destroy() {
        running?.abort.abort();
        running = null;
        showImages([]);
      },
    };
  };
}

function runnableAt(editor: Editor): number | null {
  const { $from } = editor.state.selection;
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === RUNNABLE_NODE) return $from.before(d);
  return null;
}

/** The RunnableCode node, running against `host`. */
export function runnableCode(host: RunnableHost) {
  return TiptapNode.create({
    name: RUNNABLE_NODE,
    group: "block",
    content: "text*",
    marks: "",
    code: true,
    defining: true,
    addAttributes() {
      return {
        language: { default: host.languages[0] ?? "python", parseHTML: (e) => e.getAttribute("data-runnable"), renderHTML: (a) => ({ "data-runnable": a.language }) },
        runnableId: { default: null, parseHTML: (e) => e.getAttribute("data-runnable-id"), renderHTML: (a) => ({ "data-runnable-id": a.runnableId }) },
        output: { default: null, rendered: false },
        outputFor: { default: null, rendered: false },
        displays: { default: [], rendered: false },
      };
    },
    parseHTML() {
      return [{ tag: "pre[data-runnable]", preserveWhitespace: "full", priority: 60 }];
    },
    renderHTML({ HTMLAttributes }) {
      return ["pre", mergeAttributes(HTMLAttributes), ["code", 0]];
    },
    markdownTokenizer: {
      name: RUNNABLE_NODE,
      level: "block",
      start: (src: string) => {
        const m = /^ {0,3}(?:`{3,}|~{3,})/m.exec(src);
        return m ? m.index : -1;
      },
      tokenize: (src: string) => tokenizeRunnable(src),
    },
    parseMarkdown: (token, helpers) => {
      const t = token as unknown as RunnableToken;
      return helpers.createNode(
        RUNNABLE_NODE,
        {
          language: t.language,
          runnableId: t.runnableId,
          output: t.output,
          displays: t.displays,
          outputFor: t.output != null || t.displays.length ? codeFingerprint(t.language, t.code) : null,
        },
        t.code ? [helpers.createTextNode(t.code)] : [],
      );
    },
    renderMarkdown: (node) => {
      const text = (node.content ?? []).map((c) => (c as { text?: string }).text ?? "").join("");
      return renderRunnableMarkdown(node.attrs as RunnableAttrs, text);
    },
    addNodeView() {
      return nodeView(host) as never;
    },
    addKeyboardShortcuts() {
      return {
        "Shift-Enter": () => {
          const pos = runnableAt(this.editor);
          if (pos == null) return false;
          this.editor.view.nodeDOM(pos)?.dispatchEvent(new CustomEvent(RUN_EVENT));
          return true;
        },
      };
    },
    addCommands() {
      return {
        insertRunnableCode:
          (language?: SandboxLanguage) =>
          ({ commands }: { commands: { insertContent: (c: unknown) => boolean } }) =>
            commands.insertContent({ type: RUNNABLE_NODE, attrs: { language: language ?? host.languages[0] ?? "python", runnableId: newRunnableId() } }),
      } as never;
    },
    onCreate() {
      // Give RunnableCode pasted or inserted without an id one, so its Output can point back to it.
      const { tr } = this.editor.state;
      this.editor.state.doc.descendants((n, pos) => {
        if (n.type.name === RUNNABLE_NODE && !n.attrs.runnableId) tr.setNodeMarkup(pos, undefined, { ...n.attrs, runnableId: newRunnableId() });
      });
      if (tr.docChanged) this.editor.view.dispatch(tr.setMeta("addToHistory", false));
    },
  });
}
