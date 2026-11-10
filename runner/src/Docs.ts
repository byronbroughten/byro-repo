// The Docs module: moves a Piece between a Google Doc and the repo's Markdown
// dialect. It imports nothing else from the runner, so it can move to
// `packages/` with a folder move. `Docs/googleDocs.ts` is the Google Docs layer
// (the `documents.get` body types and the port), `Docs/markdownDialect.ts` the
// dialect, and `Docs/DocReader.ts` the reader between them. The writer and the
// real API calls are still to come.

import { DocReader } from "./Docs/DocReader.ts";
import type { DocumentsPort } from "./Docs/googleDocs.ts";
import { markdownDialect } from "./Docs/markdownDialect.ts";

/** One read of a Doc: its Markdown, its Sections' bodies by heading, and the revision read. */
export interface DocRead {
  markdown: string;
  sections: Map<string, string>;
  revisionId: string;
}

export class Docs {
  private readonly documents: DocumentsPort;

  constructor(documents: DocumentsPort) {
    this.documents = documents;
  }

  static init(documents: DocumentsPort): Docs {
    return new Docs(documents);
  }

  async read(documentId: string): Promise<DocRead> {
    const document = await this.documents.documentOf(documentId);
    const { markdown } = DocReader.init(document);
    return {
      markdown,
      sections: markdownDialect.sectionsOf(markdown),
      revisionId: document.revisionId,
    };
  }
}
