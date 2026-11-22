/** The scratchpad's optional features, in toolbar order. RunnableCode joins this list. */
import { SigmaIcon, SquareTerminalIcon } from "lucide-react";
import { TAB_ID, padKeySuffix, type MathLoader, type PadScope, type SandboxConnection, type SandboxOptions, type BlobStore } from "zreader";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { PadFeature } from "./features";
import { MATH_NODE_TYPES, markdownHasMath, mathExtensions } from "./math";
import { RUNNABLE_NODE, markdownHasRunnable, runnableCode } from "./runnable";

/** What the reader's setup provides; each feature turns on when its part is present. */
export interface PadFeatureContext {
  mathLoader: MathLoader | null;
  sandbox: SandboxConnection | null;
  /** Where RunnableCode in each kind of pad runs (`reader.sandbox.scopes`). */
  sandboxScopes: SandboxOptions["scopes"];
  /** Keeps an image a run displayed (the reader-images store). */
  addImage?: (image: Blob) => Promise<string>;
  blobs?: BlobStore;
  /** The pad being edited: RunnableCode gets one Kernel per pad (and language) in this tab. */
  scope: PadScope;
}

const math: PadFeature<PadFeatureContext> = {
  name: "math",
  nodeTypes: MATH_NODE_TYPES,
  markdownHas: markdownHasMath,
  activate: ({ mathLoader: loader }) =>
    loader && {
      extensions: mathExtensions(loader),
      toolbar: (editor) => (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Insert formula"
              onClick={() => {
                const { from, to, empty } = editor.state.selection;
                const tex = empty ? "" : editor.state.doc.textBetween(from, to, " ");
                editor.chain().focus().insertContent({ type: "inlineMath", attrs: { tex } }).run();
              }}
            >
              <SigmaIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Insert formula ($…$)</TooltipContent>
        </Tooltip>
      ),
    },
};

const runnable: PadFeature<PadFeatureContext> = {
  name: "runnable",
  nodeTypes: [RUNNABLE_NODE],
  markdownHas: markdownHasRunnable,
  activate: ({ sandbox, sandboxScopes, scope, addImage, blobs }) =>
    !sandbox || sandboxScopes[scope.kind] !== "browser"
      ? null
      : {
      extensions: [
        runnableCode({
          languages: sandbox.languages,
          client: () => sandbox.client(),
          kernel: `${padKeySuffix(scope)}#${TAB_ID}`,
          codeSource: "scratchpad",
          addImage,
          blobs,
        }),
      ],
      toolbar: (editor) => (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Insert runnable code"
              onClick={() => (editor.chain().focus() as unknown as { insertRunnableCode(): { run(): boolean } }).insertRunnableCode().run()}
            >
              <SquareTerminalIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Insert runnable code (Shift+Enter runs it)</TooltipContent>
        </Tooltip>
      ),
    },
};

export const PAD_FEATURES: readonly PadFeature<PadFeatureContext>[] = [math, runnable];
