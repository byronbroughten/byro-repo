import type { DocumentsPort, GoogleDocument } from "./googleDocs.ts";

/** The scripted `documents.get` port Docs tests use, serving the documents it was given. */
export class FakeDocuments implements DocumentsPort {
  private readonly documents: GoogleDocument[];

  constructor(documents: GoogleDocument[]) {
    this.documents = documents;
  }

  documentOf(documentId: string): Promise<GoogleDocument> {
    const document = this.documents.find(
      (held) => held.documentId === documentId,
    );
    if (document === undefined) {
      return Promise.reject(new Error(`No Doc ${documentId}.`));
    }
    return Promise.resolve(document);
  }
}
