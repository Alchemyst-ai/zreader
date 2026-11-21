import Link from "next/link";
import { BookOpenIcon, FileTextIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-svh max-w-2xl flex-col justify-center gap-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">zreader · Next.js + shadcn</CardTitle>
          <CardDescription>
            Chapters from <code>content/books/</code>, compiled at build time: Markdown, MDX and HTML, images next to chapters through next/image, KaTeX
            math, offline reading and Markdown twins for agents.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/books">
              <BookOpenIcon /> Open the shelf
            </Link>
          </Button>
          <Button asChild variant="outline">
            <a href="/books/field-guide/images.md">
              <FileTextIcon /> A chapter as Markdown
            </a>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
