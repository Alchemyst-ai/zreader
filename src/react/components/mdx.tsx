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
