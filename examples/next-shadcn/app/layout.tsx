import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "zreader · Next.js + shadcn" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
