// The Docs module: reads a Google Doc into the repo's Markdown dialect and
// writes a Section back in place. `Docs/googleDocs.ts` is the Google Docs layer
// (the `documents.get` body types, the `batchUpdate` requests and the port),
// `Docs/RestDocuments.ts` the port's REST adapter,
// `Docs/markdownDialect.ts` the dialect, `Docs/DocReader.ts` the reader and
// `Docs/SectionWriter.ts` the writer between them.

import { DocReader } from "./Docs/DocReader.ts";
import { DocsRequestRefused } from "./Docs/DocsRequestRefused.ts";
import type { DocumentsPort, GoogleDocument } from "./Docs/googleDocs.ts";
import { markdownDialect } from "./Docs/markdownDialect.ts";
import { SectionWriter } from "./Docs/SectionWriter.ts";
import { StaleRevision } from "./Docs/StaleRevision.ts";

/** One read of a Doc: its Markdown, its Sections' bodies by heading, and the revision read. */
export interface DocRead {
  markdown: string;
  sections: Map<string, string>;
  revisionId: string;
}

/** A Section's new body for a Doc, the Section named by its heading as `DocRead.sections` keys it. */
export interface SectionWrite {
  documentId: string;
  heading: string;
  markdown: string;
}

export class Docs {
  private readonly documents: DocumentsPort;
  private readonly lastReads = new Map<string, GoogleDocument>();

  constructor(documents: DocumentsPort) {
    this.documents = documents;
  }

  static init(documents: DocumentsPort): Docs {
    return new Docs(documents);
  }

  async read(documentId: string): Promise<DocRead> {
    const document = await this.documents.documentOf(documentId);
    this.lastReads.set(documentId, document);
    const markdown = DocReader.init(document).markdown();
    return {
      markdown,
      sections: markdownDialect.sectionsOf(markdown),
      revisionId: document.revisionId,
    };
  }

  /** Rewrites one Section of the Doc as last read, refusing with `PendingSuggestions` before writing, or `StaleRevision` if it changed since. */
  async writeSection({
    documentId,
    heading,
    markdown,
  }: SectionWrite): Promise<void> {
    const document = this.lastReads.get(documentId);
    if (document === undefined) {
      throw new Error(`Read Doc ${documentId} before writing to it.`);
    }
    const requests = SectionWriter.init(document).requestsFor(
      heading,
      markdown,
    );
    if (requests.length === 0) {
      return;
    }
    this.lastReads.delete(documentId);
    const { revisionId } = document;
    try {
      await this.documents.batchUpdate(documentId, {
        requests,
        writeControl: { requiredRevisionId: revisionId },
      });
    } catch (error) {
      if (await this._isStale(error, document)) {
        throw new StaleRevision(documentId, revisionId);
      }
      throw error;
    }
  }

  /** Whether a refused write was refused for its revision: the API answers a stale one with a bare 400. */
  private async _isStale(
    error: unknown,
    document: GoogleDocument,
  ): Promise<boolean> {
    if (!(error instanceof DocsRequestRefused) || error.status !== 400) {
      return false;
    }
    const latest = await this.documents.documentOf(document.documentId);
    return latest.revisionId !== document.revisionId;
  }
}
