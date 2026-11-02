import { Component, lazy, Suspense, useMemo, type ReactNode } from "react";
import { toast } from "sonner";
import { CopyIcon, DownloadIcon, EllipsisIcon, Trash2Icon, XIcon } from "lucide-react";
import type { PadScope, PadScopeKind } from "zreader";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { usePad, useReader } from "../context";
import { copyText, downloadFile } from "../download";

const ScratchpadEditor = lazy(() => import("zreader/editor").then((m) => ({ default: m.ScratchpadEditor })));

const SCOPE_LABEL: Record<PadScopeKind, string> = { chapter: "Chapter", book: "Book", global: "All books" };

export function scopeFor(kind: PadScopeKind, bookId: string, chapterId: string): PadScope {
  if (kind === "global") return { kind };
  if (kind === "book") return { kind, bookId };
  return { kind, bookId, chapterId };
}

export function scopeKey(scope: PadScope): string {
  return scope.kind === "global" ? "global" : scope.kind === "book" ? `book:${scope.bookId}` : `chapter:${scope.bookId}:${scope.chapterId}`;
}

class EditorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export interface ScratchpadPanelProps {
  bookId: string;
  chapterId: string;
  kind: PadScopeKind;
  onKindChange: (kind: PadScopeKind) => void;
  onClose?: () => void;
  onEditorFocus?: () => void;
  /** Filename stem for exports. */
  title?: string;
}

function PlainEditor({ scope, onFocus }: { scope: PadScope; onFocus?: () => void }) {
  const { store } = useReader();
  const pad = usePad(scope);
  return (
    <Textarea
      value={pad.markdown}
      onChange={(e) => store.savePad(scope, e.target.value)}
      onFocus={onFocus}
      placeholder="Write in markdown. - [ ] makes a checklist item."
      className="h-full min-h-48 flex-1 resize-none font-mono text-sm"
      aria-label="Scratchpad (markdown)"
    />
  );
}

export function ScratchpadPanel({ bookId, chapterId, kind, onKindChange, onClose, onEditorFocus, title }: ScratchpadPanelProps) {
  const { store, options } = useReader();
  const scope = useMemo(() => scopeFor(kind, bookId, chapterId), [kind, bookId, chapterId]);
  const pad = usePad(scope);
  const scopes = options.scratchpad.scopes;
  const stem = `${title ?? bookId}-${kind}-notes`.replace(/[^a-z0-9-]+/gi, "-").toLowerCase();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        {scopes.length > 1 ? (
          <Tabs value={kind} onValueChange={(v) => onKindChange(v as PadScopeKind)} className="min-w-0 flex-1">
            <TabsList className="w-full">
              {scopes.map((s) => (
                <TabsTrigger key={s} value={s}>
                  {SCOPE_LABEL[s]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        ) : (
          <h2 className="flex-1 text-sm font-medium">Scratchpad</h2>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Scratchpad options">
              <EllipsisIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => downloadFile(`${stem}.md`, pad.markdown, "text/markdown")} disabled={!pad.markdown.trim()}>
              <DownloadIcon /> Download .md
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={async () => toast((await copyText(pad.markdown)) ? "Markdown copied" : "Could not copy")}
              disabled={!pad.markdown.trim()}
            >
              <CopyIcon /> Copy markdown
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={!pad.markdown.trim()}
              onSelect={() => {
                const previous = pad;
                store.clearPad(scope);
                toast("Scratchpad cleared", {
                  action: { label: "Undo", onClick: () => store.savePad(scope, previous.markdown, previous.json) },
                });
              }}
            >
              <Trash2Icon /> Clear
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {onClose && (
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Close scratchpad" onClick={onClose}>
            <XIcon />
          </Button>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <EditorBoundary key={scopeKey(scope)} fallback={<div className="flex flex-1 flex-col p-3"><PlainEditor scope={scope} onFocus={onEditorFocus} /></div>}>
          <Suspense
            fallback={
              <div className="flex flex-col gap-3 p-4">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            }
          >
            <ScratchpadEditor key={scopeKey(scope)} scope={scope} onFocus={onEditorFocus} />
          </Suspense>
        </EditorBoundary>
      </div>
    </div>
  );
}
