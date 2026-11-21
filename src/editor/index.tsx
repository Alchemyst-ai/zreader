import { Fragment, useEffect, useMemo, useRef, type ReactNode } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Node as TiptapNode, mergeAttributes, nodeInputRule } from "@tiptap/core";
import { toast } from "sonner";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import { Marked } from "marked";
import { cn } from "cn";
import {
  BoldIcon,
  CodeIcon,
  Heading2Icon,
  Heading3Icon,
  ImagePlusIcon,
  ItalicIcon,
  ListChecksIcon,
  ListIcon,
  ListOrderedIcon,
  QuoteIcon,
  Redo2Icon,
  SquareCodeIcon,
  StrikethroughIcon,
  Undo2Icon,
} from "lucide-react";
import { parseBlobUrl, type BlobStore, type PadScope } from "zreader";
import { useAddImage, useBlobStore, useMathLoader, useReader, usePad, imageFiles } from "zreader/react";
import { resolvePadFeatures, type ResolvedPadFeatures } from "./features";
import { PAD_FEATURES } from "./pad-features";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export interface ScratchpadEditorProps {
  scope: PadScope;
  placeholder?: string;
  autoFocus?: boolean;
  onFocus?: () => void;
  className?: string;
}

function Mark({ label, pressed, onPressed, disabled, children }: { label: string; pressed: boolean; onPressed: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle size="sm" aria-label={label} pressed={pressed} onPressedChange={onPressed} disabled={disabled}>
          {children}
        </Toggle>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

const IMAGE_INPUT = /(?:^|\s)(!\[([^\]]*)\]\((\S+)(?:\s+["']([^"']+)["'])?\))$/;

/**
 * A block image node (like `@tiptap/extension-image`, without the extra
 * dependency) whose view resolves `zr-blob:<id>` (images stored in IndexedDB)
 * to object URLs. Stored Markdown keeps `![alt](zr-blob:<id>)`.
 */
function readerImage(blobs: BlobStore) {
  return TiptapNode.create({
    name: "image",
    group: "block",
    draggable: true,
    atom: true,
    addAttributes() {
      return { src: { default: null }, alt: { default: null }, title: { default: null } };
    },
    parseHTML() {
      return [{ tag: "img[src]" }];
    },
    renderHTML({ HTMLAttributes }) {
      return ["img", mergeAttributes(HTMLAttributes)];
    },
    parseMarkdown: (token, helpers) => helpers.createNode("image", { src: token.href, title: token.title, alt: token.text }),
    renderMarkdown: (node) => {
      const { src = "", alt, title } = (node.attrs ?? {}) as { src?: string; alt?: string | null; title?: string | null };
      return title ? `![${alt ?? ""}](${src} "${title}")` : `![${alt ?? ""}](${src})`;
    },
    addInputRules() {
      return [
        nodeInputRule({
          find: IMAGE_INPUT,
          type: this.type,
          getAttributes: (m) => ({ alt: m[2], src: m[3], title: m[4] }),
        }),
      ];
    },
    addNodeView() {
      return ({ node }) => {
        const img = document.createElement("img");
        img.className = "zr-pad-image";
        img.draggable = true;
        let current: string | null = null;
        let blobId: string | null = null;
        const show = (src: string | null, alt: string | null, title: string | null) => {
          img.alt = alt ?? "";
          if (title) img.title = title;
          else img.removeAttribute("title");
          if (src === current) return;
          current = src;
          if (blobId) blobs.release(blobId);
          blobId = parseBlobUrl(src);
          if (!blobId) {
            if (src) img.src = src;
            else img.removeAttribute("src");
            return;
          }
          const id = blobId;
          img.removeAttribute("src");
          img.dataset.state = "loading";
          void blobs.url(id).then((url) => {
            if (blobId !== id) return;
            if (url) {
              img.src = url;
              delete img.dataset.state;
            } else img.dataset.state = "missing";
          });
        };
        show(node.attrs.src, node.attrs.alt, node.attrs.title);
        return {
          dom: img,
          update(next) {
            if (next.type !== node.type) return false;
            show(next.attrs.src, next.attrs.alt, next.attrs.title);
            return true;
          },
          destroy() {
            if (blobId) blobs.release(blobId);
          },
        };
      };
    },
  });
}

function Toolbar({ editor, onImage, features }: { editor: Editor; onImage?: () => void; features: ResolvedPadFeatures["toolbar"] }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      task: e.isActive("taskList"),
      quote: e.isActive("blockquote"),
      codeBlock: e.isActive("codeBlock"),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const c = () => editor.chain().focus();
  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="flex items-center gap-0.5 overflow-x-auto border-b bg-background px-2 py-1 [scrollbar-width:none]"
    >
      <Mark label="Checklist" pressed={s.task} onPressed={() => c().toggleTaskList().run()}>
        <ListChecksIcon />
      </Mark>
      <Mark label="Bulleted list" pressed={s.bullet} onPressed={() => c().toggleBulletList().run()}>
        <ListIcon />
      </Mark>
      <Mark label="Numbered list" pressed={s.ordered} onPressed={() => c().toggleOrderedList().run()}>
        <ListOrderedIcon />
      </Mark>
      <Separator orientation="vertical" className="mx-1 h-5" />
      <Mark label="Bold" pressed={s.bold} onPressed={() => c().toggleBold().run()}>
        <BoldIcon />
      </Mark>
      <Mark label="Italic" pressed={s.italic} onPressed={() => c().toggleItalic().run()}>
        <ItalicIcon />
      </Mark>
      <Mark label="Strikethrough" pressed={s.strike} onPressed={() => c().toggleStrike().run()}>
        <StrikethroughIcon />
      </Mark>
      <Mark label="Inline code" pressed={s.code} onPressed={() => c().toggleCode().run()}>
        <CodeIcon />
      </Mark>
      <Separator orientation="vertical" className="mx-1 h-5" />
      <Mark label="Heading" pressed={s.h2} onPressed={() => c().toggleHeading({ level: 2 }).run()}>
        <Heading2Icon />
      </Mark>
      <Mark label="Subheading" pressed={s.h3} onPressed={() => c().toggleHeading({ level: 3 }).run()}>
        <Heading3Icon />
      </Mark>
      <Mark label="Quote" pressed={s.quote} onPressed={() => c().toggleBlockquote().run()}>
        <QuoteIcon />
      </Mark>
      <Mark label="Code block" pressed={s.codeBlock} onPressed={() => c().toggleCodeBlock().run()}>
        <SquareCodeIcon />
      </Mark>
      {features.map((f) => (
        <Fragment key={f.name}>{f.render(editor)}</Fragment>
      ))}
      {onImage && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Insert image" onClick={onImage}>
              <ImagePlusIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Insert image</TooltipContent>
        </Tooltip>
      )}
      <Separator orientation="vertical" className="mx-1 h-5" />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Undo" disabled={!s.canUndo} onClick={() => c().undo().run()}>
            <Undo2Icon />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Undo</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Redo" disabled={!s.canRedo} onClick={() => c().redo().run()}>
            <Redo2Icon />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Redo</TooltipContent>
      </Tooltip>
    </div>
  );
}

/**
 * WYSIWYG markdown scratchpad (Tiptap v3). Markdown is the stored format; the
 * editor JSON is cached alongside it for lossless reloads. Typing `- [ ] `
 * creates a checklist item, `# ` a heading, `> ` a quote, and so on.
 */
export function ScratchpadEditor({ scope, placeholder = "Jot notes, ideas and to-dos…  Type “- [ ]” for a checklist.", autoFocus, onFocus, className }: ScratchpadEditorProps) {
  const { store } = useReader();
  const blobs = useBlobStore();
  const images = useAddImage();
  const pad = usePad(scope);
  const lastWritten = useRef<string | null>(pad.markdown);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fileRef = useRef<HTMLInputElement>(null);
  const addRef = useRef(images.add);
  addRef.current = images.add;
  const enabledRef = useRef(images.enabled);
  enabledRef.current = images.enabled;

  /** Store image files and insert them at `pos` (or the selection). */
  const insertFiles = async (e: Editor, files: File[], pos?: number) => {
    for (const f of files) {
      try {
        const src = await addRef.current(f);
        const node = { type: "image", attrs: { src, alt: f.name.replace(/\.[a-z0-9]+$/i, "") } };
        if (pos != null) e.chain().focus().insertContentAt(pos, node).run();
        else e.chain().focus().insertContent(node).run();
      } catch (err) {
        toast.error("Couldn't add the image", { description: (err as Error).message });
      }
    }
  };

  /** Pasted HTML can carry base64 images: move them to IndexedDB so the pad stays small. */
  const externalize = (e: Editor) => {
    if (!enabledRef.current) return;
    const found: string[] = [];
    e.state.doc.descendants((n) => {
      if (n.type.name === "image" && typeof n.attrs.src === "string" && n.attrs.src.startsWith("data:")) found.push(n.attrs.src);
    });
    for (const data of new Set(found)) {
      void addRef.current(data).then(
        (src) => {
          if (e.isDestroyed) return;
          const { tr } = e.state;
          e.state.doc.descendants((n, p) => {
            if (n.type.name === "image" && n.attrs.src === data) tr.setNodeMarkup(p, undefined, { ...n.attrs, src });
          });
          if (tr.docChanged) e.view.dispatch(tr);
        },
        () => {
          // Too large or not an image: drop it rather than store megabytes in localStorage.
          if (e.isDestroyed) return;
          const { tr } = e.state;
          const at: number[] = [];
          e.state.doc.descendants((n, p) => {
            if (n.type.name === "image" && n.attrs.src === data) at.push(p);
          });
          for (const p of at.reverse()) tr.delete(p, p + 1);
          if (tr.docChanged) e.view.dispatch(tr);
          toast.error("Couldn't add a pasted image");
        },
      );
    }
  };

  const mathLoader = useMathLoader();
  const features = useMemo(() => resolvePadFeatures({ mathLoader }, PAD_FEATURES), [mathLoader]);
  const initial = features.contentFor(pad);
  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    autofocus: autoFocus ? "end" : false,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder }),
      readerImage(blobs),
      ...features.extensions,
      // Its own marked instance: Markdown tokenizers (math) must not leak into other editors on the page.
      Markdown.configure({ marked: new Marked() as never }),
    ],
    content: initial.content as never,
    contentType: initial.contentType,
    editorProps: {
      attributes: {
        class: cn(
          "prose prose-sm max-w-none min-h-full px-4 py-3 text-foreground outline-none",
          "prose-headings:text-foreground prose-p:my-1.5 prose-p:text-foreground prose-li:text-foreground prose-strong:text-foreground prose-code:text-foreground prose-a:text-primary prose-blockquote:text-muted-foreground prose-blockquote:border-l-border prose-pre:bg-muted prose-pre:text-foreground",
        ),
        "aria-label": "Scratchpad",
        "aria-multiline": "true",
        role: "textbox",
      },
      handlePaste: (view, event) => {
        const files = imageFiles(event.clipboardData);
        if (!files.length || !enabledRef.current || !editorRef.current) return false;
        event.preventDefault();
        void insertFiles(editorRef.current, files);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        const files = imageFiles(event.dataTransfer);
        if (moved || !files.length || !enabledRef.current || !editorRef.current) return false;
        event.preventDefault();
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        void insertFiles(editorRef.current, files, pos);
        return true;
      },
    },
    onFocus: () => onFocus?.(),
    onUpdate: ({ editor: e }) => {
      externalize(e);
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        const md = e.getMarkdown();
        lastWritten.current = md;
        store.savePad(scope, md, e.getJSON());
      }, 300);
    },
  }, [features]);

  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor;

  // Flush pending edits on unmount/scope change.
  useEffect(
    () => () => {
      clearTimeout(saveTimer.current);
      if (editor && !editor.isDestroyed && lastWritten.current !== editor.getMarkdown()) {
        store.savePad(scope, editor.getMarkdown(), editor.getJSON());
      }
    },
    [editor, store, scope],
  );

  // External changes (quote-to-pad, other tabs, imports) → reload the document.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (pad.markdown === lastWritten.current) return;
    if (pad.json === undefined || !editor.isFocused) {
      const next = features.contentFor(pad);
      editor.commands.setContent(next.content as never, { contentType: next.contentType, emitUpdate: false });
      lastWritten.current = pad.markdown;
    }
  }, [editor, pad, features]);

  if (!editor) return null;
  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <Toolbar editor={editor} features={features.toolbar} onImage={images.enabled ? () => fileRef.current?.click() : undefined} />
      <EditorContent editor={editor} className="zr-editor min-h-0 flex-1 overflow-y-auto overscroll-contain" />
      {images.enabled && (
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(ev) => {
            const files = Array.from(ev.target.files ?? []);
            ev.target.value = "";
            if (files.length) void insertFiles(editor, files);
          }}
        />
      )}
    </div>
  );
}

export default ScratchpadEditor;
