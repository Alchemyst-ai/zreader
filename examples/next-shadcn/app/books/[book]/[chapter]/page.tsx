import { getChapterParams, ReaderChapter } from "zreader/next/server";

export const generateStaticParams = () => getChapterParams();

export default async function ChapterPage({ params }: { params: Promise<{ book: string; chapter: string }> }) {
  return <ReaderChapter {...await params} />;
}
