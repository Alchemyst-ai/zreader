import { NextResponse } from "next/server";
import { createAgentHandler } from "zreader/agent";

// Serves .md twins, llms.txt and the images next to chapters (_assets).
const agent = createAgentHandler();

export async function proxy(req: Request) {
  return (await agent(req)) ?? NextResponse.next();
}

// One literal per shelf route; agentMatcher(shelf) from zreader/next/server lists them.
export const config = {
  matcher: ["/books.md", "/books/:path*.md", "/books/llms.txt", "/books/llms-full.txt", "/books/:book/_assets/:path*"],
};
