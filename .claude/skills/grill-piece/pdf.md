# Reading a PDF by page

The Drive content tool returns a PDF's whole text and takes no page range, so `/grill-piece` downloads each PDF and reads it locally with macOS's PDF library. Each command prints one harmless `CoreGraphics PDF has logged an error` line on stderr.

**Download**: `get_drive_file_download_url` with the file ID saves the whole file under `~/.workspace-mcp/attachments/` and returns its path.

**Count its pages**:

```sh
osascript -l JavaScript -e 'function run(a){ObjC.import("Quartz"); return $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(a[0])).pageCount}' "<path>"
```

**Print the text of PDF pages `<from>` to `<to>`**, each under a `--- PDF page <n> ---` line; a range past the end stops at the last page, and a scanned page prints `(no text layer)`:

```sh
osascript -l JavaScript -e 'function run(a){ObjC.import("Quartz"); const d=$.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(a[0])); let o=""; for(let i=+a[1]-1;i<Math.min(+a[2],d.pageCount);i++){const s=d.pageAtIndex(i).string; o+="--- PDF page "+(i+1)+" ---\n"+(s.isNil()?"(no text layer)":s.js)+"\n"} return o}' "<path>" <from> <to>
```

A PDF page number counts from the file's first page; the page numbers printed in a book usually start later, after the front matter.
