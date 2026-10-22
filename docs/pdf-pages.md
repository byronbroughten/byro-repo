# Reading a PDF by page

The Drive content tool returns a PDF's whole text and takes no page range, so every piece stage that reads a long PDF downloads it and reads it locally, never through `get_drive_file_content`.

**Download**: `get_drive_file_download_url` with the file ID saves the whole file under `~/.workspace-mcp/attachments/` and returns its path.

**Dump its text once**, when the file will be read or quoted more than once: `npm run pdf:text -- "<path>" "<scratchpad>/<name>.txt"` writes every page under a `--- PDF page <n> ---` line, which [`npm run verify:quotes`](../scripts/quotes/verifyQuotes.ts) matches against. It needs poppler (`brew install poppler`). Without poppler, use the macOS commands below; each prints one harmless `CoreGraphics PDF has logged an error` line on stderr.

**Count its pages** (macOS fallback):

```sh
osascript -l JavaScript -e 'function run(a){ObjC.import("Quartz"); return $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(a[0])).pageCount}' "<path>"
```

**Print the text of PDF pages `<from>` to `<to>`**, each under a `--- PDF page <n> ---` line; a range past the end stops at the last page, and a scanned page prints `(no text layer)`:

```sh
osascript -l JavaScript -e 'function run(a){ObjC.import("Quartz"); const d=$.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(a[0])); let o=""; for(let i=+a[1]-1;i<Math.min(+a[2],d.pageCount);i++){const s=d.pageAtIndex(i).string; o+="--- PDF page "+(i+1)+" ---\n"+(s.isNil()?"(no text layer)":s.js)+"\n"} return o}' "<path>" <from> <to>
```

A PDF page number counts from the file's first page; the page numbers printed in a book usually start later, after the front matter. A spec gives each range as PDF pages, with the printed pages beside them when they differ.

**Delete the download when the stage ends**: `rm "<path>"`, by the path the download returned.
