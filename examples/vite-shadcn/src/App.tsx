import { Link as RouterLink, Route, Routes, useParams } from "react-router";
import { BookOpenIcon } from "lucide-react";
import { loadMath } from "zreader/math/katex";
import { BookContents, BookShelf, Callout, Reader, ReaderProvider, ZImage, type LinkComponent } from "zreader/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { books, chapterContent } from "./books";

/** zreader renders every link through this, so navigation stays client-side. */
const Link: LinkComponent = ({ href, ...props }) => <RouterLink to={href} {...props} />;

const mdxComponents = { Callout, img: ZImage };

function Home() {
  return (
    <main className="mx-auto flex min-h-svh max-w-2xl flex-col justify-center gap-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">zreader · Vite + shadcn</CardTitle>
          <CardDescription>
            A React reader in a Vite app styled with shadcn/ui tokens. MDX chapters, images, math, highlights, notes and a scratchpad, all stored in this
            browser.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Button asChild>
            <RouterLink to="/books">
              <BookOpenIcon /> Open the shelf
            </RouterLink>
          </Button>
          <Button asChild variant="outline">
            <RouterLink to="/books/field-guide/math">Jump to the math chapter</RouterLink>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}

function BookPage() {
  return <BookContents book={useParams().book!} backHref="/books" />;
}

function ChapterPage() {
  const { book, chapter } = useParams();
  const Content = chapterContent(book!, chapter!);
  if (!Content) return <NotFound />;
  return (
    <Reader key={`${book}/${chapter}`} book={book!} chapter={chapter!}>
      <Content components={mdxComponents} />
    </Reader>
  );
}

function NotFound() {
  return (
    <main className="mx-auto max-w-md p-10 text-center">
      <p className="text-muted-foreground">Nothing here.</p>
      <Button asChild variant="link">
        <RouterLink to="/books">Back to the shelf</RouterLink>
      </Button>
    </main>
  );
}

export function App() {
  return (
    <ReaderProvider books={books} Link={Link} options={{ basePath: "/books" }} math={loadMath}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/books" element={<BookShelf />} />
        <Route path="/books/:book" element={<BookPage />} />
        <Route path="/books/:book/:chapter" element={<ChapterPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </ReaderProvider>
  );
}
