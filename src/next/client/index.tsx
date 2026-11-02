/**
 * `zreader/next/client` — <ReaderProvider> pre-wired to next/link (optional Next.js adapter).
 *
 * Exists because a Server Component can't pass the `Link` function to a client
 * provider; binding it here, in a client module, removes that boilerplate.
 */
import Link from "next/link";
import { ReaderProvider, type LinkComponent, type ReaderProviderProps } from "zreader/react";

export type NextReaderProviderProps = Omit<ReaderProviderProps, "Link">;

export function NextReaderProvider(props: NextReaderProviderProps) {
  return <ReaderProvider {...props} Link={Link as unknown as LinkComponent} />;
}
