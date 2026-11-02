import { useMemo, useRef } from "react";
import { cn } from "cn";
import { CopyIcon, MessageSquarePlusIcon, QuoteIcon, TextSelectIcon, XIcon } from "lucide-react";
import type { TextSpan } from "zreader";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsDesktop } from "../context";
import { swatchClass } from "../tokens";
import type { SelectionState } from "../useChapterEngine";

export interface SelectionToolbarProps {
  selection: SelectionState | null;
  colors: string[];
  onHighlight: (span: TextSpan, color: string) => void;
  onNote: (span: TextSpan) => void;
  onSentence: (span: TextSpan) => void;
  onQuote?: (span: TextSpan, text: string) => void;
  onCopy?: (text: string) => void;
  onDismiss: () => void;
}

function Action({ label, onSelect, children }: { label: string; onSelect: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label={label} onClick={onSelect}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Actions for the current text selection. Desktop: a Popover anchored to the
 * selection (virtual anchor). Mobile: docked above the safe area, out of the
 * way of the native selection callout.
 */
export function SelectionToolbar({ selection, colors, onHighlight, onNote, onSentence, onQuote, onCopy, onDismiss }: SelectionToolbarProps) {
  const isDesktop = useIsDesktop();
  // Keep the last selection: on touch devices it can collapse before `click`.
  const last = useRef<SelectionState | null>(null);
  if (selection) last.current = selection;
  const current = () => last.current;

  const anchorRef = useMemo(
    () => ({
      current: {
        getBoundingClientRect: () => {
          const r = last.current?.rect;
          return DOMRect.fromRect(r ? { x: r.left, y: r.top, width: r.width, height: r.height } : undefined);
        },
      },
    }),
    [],
  );

  const keepSelection = (e: React.PointerEvent | React.MouseEvent) => e.preventDefault();

  const actions = (
    <div className="flex items-center gap-0.5" role="toolbar" aria-label="Selection actions" onPointerDown={keepSelection} onMouseDown={keepSelection}>
      <div className="flex items-center gap-1 px-1">
        {colors.map((c) => (
          <Button
            key={c}
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Highlight ${c}`}
            onClick={() => current() && onHighlight(current()!.span, c)}
          >
            <span className={cn("size-5 rounded-full ring-1 ring-foreground/15", swatchClass(c))} />
          </Button>
        ))}
      </div>
      <Separator orientation="vertical" className="mx-1 h-6" />
      <Action label="Whole sentence" onSelect={() => current() && onSentence(current()!.span)}>
        <TextSelectIcon />
      </Action>
      <Action label="Add note" onSelect={() => current() && onNote(current()!.span)}>
        <MessageSquarePlusIcon />
      </Action>
      {onQuote && (
        <Action label="Quote to scratchpad" onSelect={() => current() && onQuote(current()!.span, current()!.text)}>
          <QuoteIcon />
        </Action>
      )}
      {onCopy && (
        <Action label="Copy" onSelect={() => current() && onCopy(current()!.text)}>
          <CopyIcon />
        </Action>
      )}
      {!isDesktop && (
        <Action label="Dismiss" onSelect={onDismiss}>
          <XIcon />
        </Action>
      )}
    </div>
  );

  if (isDesktop) {
    return (
      <Popover open={!!selection} modal={false}>
        <PopoverAnchor virtualRef={anchorRef} />
        <PopoverContent
          side="top"
          align="center"
          sideOffset={10}
          className="w-auto p-1"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onEscapeKeyDown={onDismiss}
        >
          {actions}
        </PopoverContent>
      </Popover>
    );
  }

  if (!selection) return null;
  return (
    <div className="fixed inset-x-2 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 flex justify-center animate-in fade-in-0 slide-in-from-bottom-2">
      <div className="max-w-full overflow-x-auto rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg">{actions}</div>
    </div>
  );
}
