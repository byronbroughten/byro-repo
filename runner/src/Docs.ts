// The Docs module: reads a Google Doc into the repo's Markdown dialect.
// `Docs/googleDocs.ts` is the Google Docs layer (the `documents.get` body types
// and the port), `Docs/markdownDialect.ts` the dialect, and `Docs/DocReader.ts`
// the reader between them.

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
    const markdown = DocReader.init(document).markdown();
    return {
      markdown,
      sections: markdownDialect.sectionsOf(markdown),
      revisionId: document.revisionId,
    };
  }
}
