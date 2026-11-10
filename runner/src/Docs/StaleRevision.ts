/** A write refused because the Doc changed after the revision the Docs module read. */
export class StaleRevision extends Error {
  readonly documentId: string;
  readonly revisionId: string;

  constructor(documentId: string, revisionId: string) {
    super(
      `Doc ${documentId} changed after revision ${revisionId} was read; read it again before writing.`,
    );
    this.name = "StaleRevision";
    this.documentId = documentId;
    this.revisionId = revisionId;
  }
}
