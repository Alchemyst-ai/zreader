/** The scratchpad's optional features, in toolbar order. RunnableCode joins this list. */
import { SigmaIcon } from "lucide-react";
import type { MathLoader } from "zreader";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { PadFeature } from "./features";
import { MATH_NODE_TYPES, markdownHasMath, mathExtensions } from "./math";

/** What the reader's setup provides; each feature turns on when its part is present. */
export interface PadFeatureContext {
  mathLoader: MathLoader | null;
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

export const PAD_FEATURES: readonly PadFeature<PadFeatureContext>[] = [math];
