---
status: accepted
---

# Outputs are stored in the pad's markdown, without timing or status

A pad's Output is written into its markdown as an `output` fence directly after the RunnableCode, so an exported pad is a readable notebook. The block holds only the last run's text. Run duration and status stay out of the markdown, so running unchanged code does not rewrite the pad. Rich output (images, plots) is stored in the BlobStore and referenced as `zr-blob:`, because records never embed binary data. The UI marks an Output stale when the code no longer matches the run that produced it; the markdown does not record staleness.

Chapter Outputs are never written back: an author's `output` fence is shown as the initial Output, and a reader's run lasts only as long as the page.
