import { ScratchpadMath } from "zreader/math/katex";
import { ReaderRoot } from "zreader/next/server";
import { ScratchpadSandbox } from "zreader/sandbox/browser";

// The shelf's provider: catalogue from content/books, next/link and next/image,
// and the "Copy reference" button for agents. <ScratchpadMath /> renders $…$ in
// the scratchpad with KaTeX, loaded in the browser only when a pad has math, and
// <ScratchpadSandbox /> lets readers run Python and JavaScript in their pads.
export default function BooksLayout({ children }: { children: React.ReactNode }) {
  return (
    <ReaderRoot agent>
      <ScratchpadMath />
      <ScratchpadSandbox />
      {children}
    </ReaderRoot>
  );
}
