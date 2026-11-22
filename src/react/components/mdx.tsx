import type * as React from "react";
import type { ReactNode } from "react";
import { LightbulbIcon } from "lucide-react";
import { RUNNABLE_ID, codeFingerprint, sandboxLanguage } from "zreader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export interface CalloutProps {
  title?: string;
  children?: ReactNode;
}

/** `<Callout title="…">…</Callout>` for MDX chapters. Ignored by highlighting. */
export function Callout({ title, children }: CalloutProps) {
  return (
    <Alert className="not-prose my-6" data-zr-ignore="">
      <LightbulbIcon />
      {title && <AlertTitle>{title}</AlertTitle>}
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

export type ZImageProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  "data-zr-image"?: string;
  "data-zr-zoom"?: string;
};

/**
 * The plain `<img>` zreader renders outside Next.js: lazy and async-decoded by
 * default, and sized by CSS so `width`/`height` only reserve space.
 * Pass it as `components={{ img: ZImage }}` to MDX or `htmlToReact`.
 */
export function ZImage({ loading = "lazy", decoding = "async", alt = "", ...props }: ZImageProps) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img loading={loading} decoding={decoding} alt={alt} {...props} />;
}

export interface RunnableCodeProps {
  /** `python` / `py`, `javascript` / `js` or `typescript` / `ts`. Other languages show as plain code. */
  language: string;
  code: string;
  /** Pairs the block with its Output. Defaults to one derived from the code. */
  id?: string;
  /** The author's Output, shown until the reader runs the code. */
  output?: string;
}

/**
 * `<RunnableCode language="python" code={…} output="42" />` for MDX chapters:
 * the same blocks a ```` ```python run ```` fence produces, so readers can run
 * it where the site provides a Sandbox. Elsewhere it's a plain code block.
 */
export function RunnableCode({ language: info, code, id: given, output }: RunnableCodeProps) {
  const language = sandboxLanguage(info);
  const lang = language ?? info;
  const id = given && RUNNABLE_ID.test(given) ? given : `c${codeFingerprint(lang, code)}`;
  return (
    <>
      <pre {...(language ? { "data-zr-runnable": language, "data-zr-runnable-id": id } : {})}>
        <code className={`language-${lang}`}>{code}</code>
      </pre>
      {output != null && (
        <pre {...(language ? { "data-zr-output-for": id } : {})}>
          <code className="language-output">{output}</code>
        </pre>
      )}
    </>
  );
}
