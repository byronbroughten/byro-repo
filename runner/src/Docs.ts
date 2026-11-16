// The Docs module: reads a Google Doc into the repo's Markdown dialect and
// writes a Section back in place. `Docs/googleDocs.ts` is the Google Docs layer
// (the `documents.get` body types, the `batchUpdate` requests and the port),
// `Docs/RestDocuments.ts` the port's REST adapter,
// `Docs/markdownDialect.ts` the dialect, `Docs/DocReader.ts` the reader and
// `Docs/SectionWriter.ts` the writer between them.

import { DocReader } from "./Docs/DocReader.ts";
import { DocsRequestRefused } from "./Docs/DocsRequestRefused.ts";
import type { DocumentsPort, GoogleDocument } from "./Docs/googleDocs.ts";
import { markdownDialect, type SectionKey } from "./Docs/markdownDialect.ts";
import { SectionWriter } from "./Docs/SectionWriter.ts";
import { StaleRevision } from "./Docs/StaleRevision.ts";

/** One read of a Doc: its Markdown, its Sections' bodies and their headings' headingIds by heading path, and the revision read. */
export interface DocRead {
  markdown: string;
  sections: Map<string, string>;
  headingIds: Map<string, string>;
  revisionId: string;
}

/** A Section's new body for a Doc, the Section found by its heading's headingId, then by its path as `DocRead.sections` keys it. */
export interface SectionWrite extends SectionKey {
  documentId: string;
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
    const reader = DocReader.init(document);
    const markdown = reader.markdown();
    return {
      markdown,
      sections: markdownDialect.sectionsOf(markdown),
      headingIds: reader.headingIds(),
      revisionId: document.revisionId,
    };
  }

  /** Rewrites one Section of the Doc as last read, refusing with `PendingSuggestions` before writing, or `StaleRevision` if it changed since. */
  async writeSection({
    documentId,
    headingPath,
    headingId,
    markdown,
  }: SectionWrite): Promise<void> {
    const document = this.lastReads.get(documentId);
    if (document === undefined) {
      throw new Error(`Read Doc ${documentId} before writing to it.`);
    }
    const requests = SectionWriter.init(document).requestsFor(
      { headingPath, headingId },
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

/** A Section's text in a read, found as `Docs.writeSection` finds it: by its headingId, then by its heading path. */
export function sectionTextOf(
  read: DocRead,
  { headingPath, headingId }: SectionKey,
): string | undefined {
  const idPath = [...read.headingIds].find(([, id]) => id === headingId)?.[0];
  return read.sections.get(idPath ?? headingPath);
}
