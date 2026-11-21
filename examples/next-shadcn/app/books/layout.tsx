import { ReaderRoot } from "zreader/next/server";

// The shelf's provider: catalogue from content/books, next/link and next/image,
// and the "Copy reference" button for agents.
export default function BooksLayout({ children }: { children: React.ReactNode }) {
  return <ReaderRoot agent>{children}</ReaderRoot>;
}
