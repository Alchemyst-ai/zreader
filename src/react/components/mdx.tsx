import type * as React from "react";
import type { ReactNode } from "react";
import { LightbulbIcon } from "lucide-react";
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
