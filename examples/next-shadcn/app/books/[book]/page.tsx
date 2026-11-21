import { BookContents } from "zreader/react";
import { getBookParams } from "zreader/next/server";

export const generateStaticParams = () => getBookParams();

export default async function BookPage({ params }: { params: Promise<{ book: string }> }) {
  return <BookContents book={(await params).book} backHref="/books" />;
}
