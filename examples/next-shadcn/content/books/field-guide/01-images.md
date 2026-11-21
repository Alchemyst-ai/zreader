---
title: Images
description: Files next to the chapter, URLs, base64 and the viewer.
---

This chapter is Markdown. Select any sentence to **highlight** it, add a note, or quote it into the scratchpad.

## A file next to the chapter

The chart below lives at `content/books/field-guide/images/diagram.png`. zreader serves it from `/books/field-guide/_assets/<hash>/images/diagram.png` and `ReaderChapter` renders it through `next/image`.

![A bar chart](./images/diagram.png "Measured at build time and optimized by next/image. Tap it to open the viewer.")

## A remote image

`upload.wikimedia.org` is in `content.images.allowRemote`, so `withReader` adds it to `images.remotePatterns`:

<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/React-icon.svg/500px-React-icon.svg.png" width="500" height="445" alt="The React logo">

## Base64

Inline images stay in the line, like this dot ![a blue dot](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFklEQVR42mNkYPhfz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC).

## Images in your notes

Open the scratchpad and paste or drop an image. It's stored in this browser (IndexedDB) and included in backups.
