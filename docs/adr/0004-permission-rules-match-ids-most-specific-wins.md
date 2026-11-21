---
status: accepted
---

# Permission rules match book and chapter ids, and the most specific rule wins

Per-chapter Dangerous permissions are written as route-style patterns (`*`, `ml-book/*`, `ml-book/ch-7`) relative to a shelf, but they match `bookId/chapterId`, not URLs. Sites can change URLs with `hrefFor`, while ids are the stable key zreader uses everywhere else. When several rules match, only the most specific one applies, in full, with no merging, and a shelf's rules replace the site's rules. A chapter's permissions can then be read in one place, and a broad rule can never quietly widen a narrow one.

Only the site owner grants Dangerous permissions. `book.json`, chapter frontmatter and readers cannot.
