import { useEffect, useRef, type ReactNode } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import { cn } from "cn";
import {
  BoldIcon,
  CodeIcon,
  Heading2Icon,
  Heading3Icon,
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
import type { PadScope } from "zreader";
import { useReader, usePad } from "zreader/react";
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

function Toolbar({ editor }: { editor: Editor }) {
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
  const pad = usePad(scope);
  const lastWritten = useRef<string | null>(pad.markdown);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    autofocus: autoFocus ? "end" : false,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder }),
      Markdown,
    ],
    content: pad.json ?? pad.markdown,
    contentType: pad.json ? "json" : "markdown",
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
    },
    onFocus: () => onFocus?.(),
    onUpdate: ({ editor: e }) => {
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        const md = e.getMarkdown();
        lastWritten.current = md;
        store.savePad(scope, md, e.getJSON());
      }, 300);
    },
  });

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
      editor.commands.setContent(pad.json ?? pad.markdown, { contentType: pad.json ? "json" : "markdown", emitUpdate: false });
      lastWritten.current = pad.markdown;
    }
  }, [editor, pad]);

  if (!editor) return null;
  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <Toolbar editor={editor} />
      <EditorContent editor={editor} className="zr-editor min-h-0 flex-1 overflow-y-auto overscroll-contain" />
    </div>
  );
}

export default ScratchpadEditor;
