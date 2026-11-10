/** A write refused because the Doc holds pending suggestions the writer can't compute indices around safely. */
export class PendingSuggestions extends Error {
  readonly documentId: string;

  constructor(documentId: string) {
    super(
      `Doc ${documentId} has pending suggestions the writer can't index around safely; accept or reject them before writing.`,
    );
    this.name = "PendingSuggestions";
    this.documentId = documentId;
  }
}
