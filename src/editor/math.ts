/**
 * Math nodes for the scratchpad: `$…$` (inline) and `$$…$$` (block), stored in
 * the pad's Markdown as written. Rendered with the app's MathML renderer
 * (`zreader/math/katex` or `zreader/math/temml`); click a formula, or select it
 * and press Enter, to edit its TeX.
 */
import { InputRule, Node as TiptapNode, mergeAttributes, type Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { loadMathRenderer, type MathLoader, type MathRenderer } from "zreader";
import { jsonHas } from "./features";

/** `$x$`: no space inside the dollars, and the closing one not followed by a digit (`$5 and $6` is text). */
export const INLINE_MATH = /^\$(?!\s)((?:\\.|[^\\$\n])+?)(?<!\s)\$(?!\d)/;
/** `$$ … $$` at the start of a line, on one line or several. */
export const BLOCK_MATH = /^\$\$[ \t]*\n?([\s\S]+?)\n?[ \t]*\$\$[ \t]*(?:\n|$)/;

const EDIT_EVENT = "zr-math-edit";

function nodeView(display: boolean, loader: MathLoader) {
  return ({ node: initial, getPos, editor }: { node: { attrs: Record<string, unknown>; type: unknown; nodeSize: number }; getPos: () => number | undefined; editor: Editor }) => {
    let node = initial;
    let tex = String(node.attrs.tex ?? "");
    let editing = false;
    let renderer: MathRenderer | null = null;
    const dom = document.createElement(display ? "div" : "span");
    dom.className = "zr-pad-math";
    dom.dataset.display = display ? "block" : "inline";
    dom.contentEditable = "false";

    const show = () => {
      dom.removeAttribute("data-state");
      dom.setAttribute("role", "button");
      dom.setAttribute("aria-label", `Formula ${tex}. Press Enter to edit.`);
      if (!renderer) {
        dom.textContent = display ? `$$${tex}$$` : `$${tex}$`;
        dom.dataset.state = "loading";
        return;
      }
      try {
        dom.innerHTML = renderer(tex, display);
      } catch {
        dom.textContent = tex;
        dom.dataset.state = "error";
      }
    };

    const open = () => {
      if (editing || !editor.isEditable) return;
      editing = true;
      const input: HTMLInputElement | HTMLTextAreaElement = document.createElement(display ? "textarea" : "input");
      input.className = "zr-pad-math-input";
      input.value = tex;
      input.spellcheck = false;
      input.setAttribute("aria-label", display ? "TeX (Ctrl+Enter to finish)" : "TeX (Enter to finish)");
      if (input instanceof HTMLTextAreaElement) input.rows = Math.max(2, tex.split("\n").length);
      dom.removeAttribute("role");
      dom.replaceChildren(input);
      input.focus();
      input.select();

      const close = (save: boolean) => {
        if (!editing) return;
        editing = false;
        const next = input.value.trim();
        const pos = getPos();
        if (typeof pos !== "number") return;
        if (save ? !next : !tex) {
          editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
          return;
        }
        if (save && next !== tex) {
          editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { tex: next }));
        } else {
          show();
        }
        editor.commands.focus();
      };
      (input as HTMLElement).addEventListener("keydown", (e: KeyboardEvent) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          close(false);
        } else if (e.key === "Enter" && (!display || e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          close(true);
        }
      });
      input.addEventListener("blur", () => close(true));
    };

    dom.addEventListener("click", open);
    dom.addEventListener(EDIT_EVENT, open);
    show();
    void loadMathRenderer(loader).then(
      (r) => {
        renderer = r;
        if (!editing) show();
      },
      () => {
        dom.dataset.state = "error";
      },
    );
    // A formula inserted empty (toolbar, `$$ `) opens for editing.
    if (!tex) queueMicrotask(open);

    return {
      dom,
      update(next: typeof node) {
        if (next.type !== node.type) return false;
        node = next;
        const t = String(next.attrs.tex ?? "");
        if (t !== tex) {
          tex = t;
          if (!editing) show();
        }
        return true;
      },
      selectNode: () => dom.classList.add("ProseMirror-selectednode"),
      deselectNode: () => dom.classList.remove("ProseMirror-selectednode"),
      stopEvent: (e: Event) => editing && e.target !== dom,
      ignoreMutation: () => true,
    };
  };
}

function editSelected(editor: Editor, type: string): boolean {
  const sel = editor.state.selection;
  if (!(sel instanceof NodeSelection) || sel.node.type.name !== type) return false;
  editor.view.nodeDOM(sel.from)?.dispatchEvent(new CustomEvent(EDIT_EVENT));
  return true;
}

export function mathExtensions(loader: MathLoader) {
  const inline = TiptapNode.create({
    name: "inlineMath",
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,
    addAttributes() {
      return { tex: { default: "" } };
    },
    parseHTML() {
      return [{ tag: "span[data-math-inline]", getAttrs: (el) => ({ tex: (el as HTMLElement).getAttribute("data-tex") ?? "" }) }];
    },
    renderHTML({ node, HTMLAttributes }) {
      return ["span", mergeAttributes(HTMLAttributes, { "data-math-inline": "", "data-tex": node.attrs.tex }), `$${node.attrs.tex}$`];
    },
    markdownTokenizer: {
      name: "inlineMath",
      level: "inline",
      start: (src: string) => src.indexOf("$"),
      tokenize: (src: string) => {
        const m = INLINE_MATH.exec(src);
        if (!m || m[0].startsWith("$$")) return undefined;
        return { type: "inlineMath", raw: m[0], tex: m[1]!.trim() };
      },
    },
    parseMarkdown: (token) => ({ type: "inlineMath", attrs: { tex: String((token as { tex?: string }).tex ?? "") } }),
    renderMarkdown: (node) => `$${String(node.attrs?.tex ?? "")}$`,
    addNodeView() {
      return nodeView(false, loader) as never;
    },
    addInputRules() {
      return [
        new InputRule({
          find: /(?:^|\s)(\$([^$\s](?:[^$]*[^$\s])?)\$)$/,
          handler: ({ state, range, match }) => {
            // range.from is where match[0] starts; skip the leading space, if any.
            const from = range.from + (match[0].length - match[1]!.length);
            state.tr.replaceWith(from, range.to, this.type.create({ tex: match[2] }));
          },
        }),
      ];
    },
    addKeyboardShortcuts() {
      return { Enter: () => editSelected(this.editor, this.name) };
    },
  });

  const block = TiptapNode.create({
    name: "blockMath",
    group: "block",
    atom: true,
    selectable: true,
    draggable: true,
    addAttributes() {
      return { tex: { default: "" } };
    },
    parseHTML() {
      return [{ tag: "div[data-math-block]", getAttrs: (el) => ({ tex: (el as HTMLElement).getAttribute("data-tex") ?? "" }) }];
    },
    renderHTML({ node, HTMLAttributes }) {
      return ["div", mergeAttributes(HTMLAttributes, { "data-math-block": "", "data-tex": node.attrs.tex }), `$$${node.attrs.tex}$$`];
    },
    markdownTokenizer: {
      name: "blockMath",
      level: "block",
      start: (src: string) => src.indexOf("$$"),
      tokenize: (src: string) => {
        const m = BLOCK_MATH.exec(src);
        if (!m) return undefined;
        return { type: "blockMath", raw: m[0], tex: m[1]!.trim() };
      },
    },
    parseMarkdown: (token) => ({ type: "blockMath", attrs: { tex: String((token as { tex?: string }).tex ?? "") } }),
    renderMarkdown: (node) => `$$\n${String(node.attrs?.tex ?? "")}\n$$`,
    addNodeView() {
      return nodeView(true, loader) as never;
    },
    addInputRules() {
      return [
        // `$$ ` in an empty paragraph → an empty display formula, open for editing.
        new InputRule({
          find: /^\$\$\s$/,
          handler: ({ state, range }) => {
            const $from = state.doc.resolve(range.from);
            // Depending on the Tiptap version, the typed space may already be in the document.
            if (!/^\$\$\s?$/.test($from.parent.textContent)) return null;
            state.tr.replaceRangeWith($from.before(), $from.after(), this.type.create({ tex: "" }));
          },
        }),
      ];
    },
    addKeyboardShortcuts() {
      return { Enter: () => editSelected(this.editor, this.name) };
    },
  });

  return [inline, block];
}

export const MATH_NODE_TYPES = ["inlineMath", "blockMath"] as const;

/** Does editor JSON contain math nodes? */
export function jsonHasMath(json: unknown): boolean {
  return jsonHas(json, MATH_NODE_TYPES);
}

/** Does Markdown contain something the math tokenizers would turn into math? */
export function markdownHasMath(markdown: string): boolean {
  for (const raw of markdown.split("\n")) {
    const line = raw.replace(/^(?:\s*>)+\s?/, "");
    if (/^\s*\$\$/.test(line)) return true;
    for (let i = line.indexOf("$"); i >= 0; i = line.indexOf("$", i + 1)) {
      if (line[i + 1] !== "$" && line[i - 1] !== "$" && INLINE_MATH.test(line.slice(i))) return true;
    }
  }
  return false;
}
