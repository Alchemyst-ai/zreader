import { useCallback } from "react";
import { cn } from "cn";
import { toast } from "sonner";
import { ChevronDownIcon, CopyIcon, ExternalLinkIcon, FileTextIcon, LinkIcon } from "lucide-react";
import { copyText } from "zreader/react";
import { useOptionalReaderChapter } from "./markdown-alternate";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DEFAULT_ASK_PROMPT,
  DEFAULT_PROMPT,
  DEFAULT_PROVIDERS,
  formatPrompt,
  markdownUrl,
  resolveProvider,
  type BuiltInProvider,
  type ProviderSpec,
} from "./reference";

export interface CopyReferenceProps {
  /**
   * Reference the page's `.md` twin (served by `createAgentHandler()` from
   * `zreader/agent`). `false` (default) references the page URL itself, so the
   * button never points at a route your app doesn't serve. Pass a function to
   * map page URLs to Markdown URLs yourself (e.g. for hash routing).
   */
  markdown?: boolean | ((pageUrl: string) => string);
  /** Copied text. `{url}` is replaced with the reference URL. */
  prompt?: string;
  /** Prompt sent to the assistants in the menu. */
  askPrompt?: string;
  /** Assistants offered in the menu, in order. `[]` hides them. */
  providers?: Array<BuiltInProvider | ProviderSpec>;
  /** Button text from the `lg` breakpoint up (icon-only below). */
  label?: string;
  className?: string;
}

/**
 * "Copy reference" split button for the reader's top bar: copies a prompt that
 * points an AI agent at this chapter, with a menu to open it in ChatGPT,
 * Claude or Grok.
 *
 *   <Reader … actions={<CopyReference markdown />} />
 */
export function CopyReference({
  markdown = false,
  prompt = DEFAULT_PROMPT,
  askPrompt = DEFAULT_ASK_PROMPT,
  providers = DEFAULT_PROVIDERS,
  label = "Copy reference",
  className,
}: CopyReferenceProps) {
  const ctx = useOptionalReaderChapter();

  // Built on click (not render), so SSR and hydration never see `window`.
  const referenceUrl = useCallback(() => {
    const page = ctx ? new URL(ctx.href(ctx.chapter.id), window.location.href).href : window.location.href;
    if (!markdown) return page.split("#")[0]!;
    return typeof markdown === "function" ? markdown(page) : markdownUrl(page);
  }, [ctx, markdown]);

  const copy = async (text: string, what: string) => {
    if (await copyText(text)) toast.success(`${what} copied`, { description: text });
    else toast.error("Could not copy");
  };
  const copyPrompt = () => void copy(formatPrompt(prompt, referenceUrl()), "Reference");
  const copyUrl = () => void copy(referenceUrl(), markdown ? "Markdown URL" : "Link");
  const open = (p: ProviderSpec) => {
    window.open(p.href(formatPrompt(askPrompt, referenceUrl())), "_blank", "noopener,noreferrer");
  };
  const specs = providers.map(resolveProvider);

  return (
    <div className={cn("flex items-center", className)} data-zr-copy-reference="">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button type="button" variant="ghost" size="icon" aria-label={label} onClick={copyPrompt} className="hidden rounded-r-none sm:inline-flex lg:w-auto lg:px-3">
            <LinkIcon />
            <span className="hidden lg:inline">{label}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Copy a prompt that points an AI agent at this page</TooltipContent>
      </Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon" aria-label="Reference options" className="sm:w-6 sm:rounded-l-none">
            <LinkIcon className="sm:hidden" />
            <ChevronDownIcon className="hidden sm:block" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuItem onSelect={copyPrompt}>
            <CopyIcon />
            {label}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={copyUrl}>
            <FileTextIcon />
            {markdown ? "Copy Markdown URL" : "Copy link"}
          </DropdownMenuItem>
          {specs.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Ask about this page</DropdownMenuLabel>
              {specs.map((p) => (
                <DropdownMenuItem key={p.id} onSelect={() => open(p)}>
                  <ExternalLinkIcon />
                  Open in {p.label}
                </DropdownMenuItem>
              ))}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
