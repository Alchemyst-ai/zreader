import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { cn } from "cn";
import { toast } from "sonner";
import { CopyIcon, ImagePlusIcon, QuoteIcon, Trash2Icon, XIcon } from "lucide-react";
import { highlightText, type Highlight } from "zreader";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ResponsivePanel } from "./responsive-panel";
import { BlobImage, imageFiles, noteImages, useAddImage } from "./blob-image";
import { quoteBorderClass, swatchClass } from "../tokens";

export interface HighlightPanelProps {
  highlight: Highlight | null;
  colors: string[];
  focusNote?: boolean;
  onColor: (color: string) => void;
  onNote: (note: string) => void;
  onDelete: () => void;
  onQuote?: () => void;
  onCopy?: () => void;
  onClose: () => void;
}

export function HighlightPanel({ highlight, colors, focusNote, onColor, onNote, onDelete, onQuote, onCopy, onClose }: HighlightPanelProps) {
  const [note, setNote] = useState(highlight?.note ?? "");
  const saved = useRef(highlight?.note ?? "");
  const textRef = useRef<HTMLTextAreaElement>(null);
  const id = highlight?.id;

  useEffect(() => {
    setNote(highlight?.note ?? "");
    saved.current = highlight?.note ?? "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Debounced autosave.
  useEffect(() => {
    if (note === saved.current) return;
    const t = setTimeout(() => {
      saved.current = note;
      onNote(note);
    }, 400);
    return () => clearTimeout(t);
  }, [note, onNote]);

  useEffect(() => {
    if (!focusNote || !id) return;
    const t = setTimeout(() => textRef.current?.focus(), 250);
    return () => clearTimeout(t);
  }, [focusNote, id]);

  const images = useAddImage();
  const fileRef = useRef<HTMLInputElement>(null);

  /** Store the files and insert `![](zr-blob:…)` at the caret. */
  const addImages = async (files: File[]) => {
    const el = textRef.current;
    const at = el ? [el.selectionStart, el.selectionEnd] : [note.length, note.length];
    const refs: string[] = [];
    for (const f of files) {
      try {
        refs.push(`![${f.name.replace(/\.[a-z0-9]+$/i, "").replace(/[[\]]/g, "")}](${await images.add(f)})`);
      } catch (e) {
        toast.error("Couldn't add the image", { description: (e as Error).message });
      }
    }
    if (!refs.length) return;
    setNote((n) => {
      const before = n.slice(0, at[0]);
      const sep = before && !before.endsWith("\n") ? "\n" : "";
      return `${before}${sep}${refs.join("\n")}\n${n.slice(at[1])}`;
    });
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = imageFiles(e.clipboardData);
    if (!images.enabled || !files.length) return;
    e.preventDefault();
    void addImages(files);
  };
  const onDrop = (e: DragEvent<HTMLTextAreaElement>) => {
    const files = imageFiles(e.dataTransfer);
    if (!images.enabled || !files.length) return;
    e.preventDefault();
    void addImages(files);
  };
  const removeImage = (src: string) => setNote((n) => n.replace(new RegExp(`!\\[[^\\]]*\\]\\(${src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)\\n?`), ""));
  const attached = noteImages(note);

  const flush = () => {
    if (note !== saved.current) {
      saved.current = note;
      onNote(note);
    }
  };

  const exact = highlight ? highlightText(highlight) : "";

  return (
    <ResponsivePanel
      open={!!highlight}
      onOpenChange={(open) => {
        if (!open) {
          flush();
          onClose();
        }
      }}
      title="Highlight"
      description="Change the colour, add a note, or remove it."
      footer={
        <div className="flex flex-wrap gap-2">
          {onCopy && (
            <Button type="button" variant="outline" onClick={onCopy}>
              <CopyIcon /> Copy
            </Button>
          )}
          {onQuote && (
            <Button type="button" variant="outline" onClick={onQuote}>
              <QuoteIcon /> To scratchpad
            </Button>
          )}
          <Button type="button" variant="destructive" onClick={onDelete}>
            <Trash2Icon /> Delete
          </Button>
        </div>
      }
    >
      {highlight && (
        <div className="flex flex-col gap-4">
          <blockquote className={cn("line-clamp-6 border-l-4 pl-3 font-serif text-sm text-muted-foreground", quoteBorderClass(highlight.color))}>
            {exact}
          </blockquote>
          <ToggleGroup
            type="single"
            variant="outline"
            value={highlight.color}
            onValueChange={(v) => v && onColor(v)}
            aria-label="Highlight colour"
            className="justify-start"
          >
            {colors.map((c) => (
              <ToggleGroupItem key={c} value={c} aria-label={c}>
                <span className={cn("size-4 rounded-full ring-1 ring-foreground/15", swatchClass(c))} />
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <div className="grid gap-2">
            <Label htmlFor={`zr-note-${highlight.id}`}>Note</Label>
            <Textarea
              id={`zr-note-${highlight.id}`}
              ref={textRef}
              rows={4}
              value={note}
              placeholder="Add a note…"
              onChange={(e) => setNote(e.target.value)}
              onBlur={flush}
              onPaste={onPaste}
              onDrop={onDrop}
            />
            {attached.length > 0 && (
              <ul className="flex flex-wrap gap-2" aria-label="Images in this note">
                {attached.map((img, i) => (
                  <li key={`${img.src}-${i}`} className="relative">
                    <BlobImage src={img.src} alt={img.alt} className="h-16 w-auto rounded-md border object-cover" />
                    <button
                      type="button"
                      className="absolute -top-1.5 -right-1.5 inline-flex size-5 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm hover:text-foreground [&_svg]:size-3"
                      aria-label={`Remove image${img.alt ? ` ${img.alt}` : ""}`}
                      onClick={() => removeImage(img.src)}
                    >
                      <XIcon />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {images.enabled && (
              <>
                <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => fileRef.current?.click()}>
                  <ImagePlusIcon /> Add image
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    e.target.value = "";
                    void addImages(files);
                  }}
                />
              </>
            )}
          </div>
        </div>
      )}
    </ResponsivePanel>
  );
}
