import { useEffect, useRef, useState } from "react";
import { cn } from "cn";
import { CopyIcon, QuoteIcon, Trash2Icon } from "lucide-react";
import type { Highlight } from "zreader";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ResponsivePanel } from "./responsive-panel";
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

  const flush = () => {
    if (note !== saved.current) {
      saved.current = note;
      onNote(note);
    }
  };

  const exact = highlight?.anchor.exact ?? "";

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
            />
          </div>
        </div>
      )}
    </ResponsivePanel>
  );
}
