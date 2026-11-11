import { DocsRequestRefused } from "./DocsRequestRefused.ts";
import { FakeBody } from "./FakeBody.ts";
import type {
  BatchUpdateRequest,
  DocumentsPort,
  GoogleDocument,
  StructuralElement,
} from "./googleDocs.ts";

/**
 * The in-memory Docs API Docs tests use: serves the documents it was given with
 * their indices filled in, and applies a `batchUpdate` to one, refusing it with
 * a 400 on a stale `requiredRevisionId` as the API does.
 */
export class FakeDocuments implements DocumentsPort {
  private readonly documents: GoogleDocument[];
  private revisionCount = 0;
  private pendingChange: PendingChange | undefined;

  constructor(documents: GoogleDocument[]) {
    this.documents = documents.map((document) => structuredClone(document));
  }

  documentOf(documentId: string): Promise<GoogleDocument> {
    return Promise.resolve().then(() => indexed(this._held(documentId)));
  }

  /** Changes a held Doc as someone in the editor would; the change sets its revision. */
  edit(documentId: string, change: DocumentChange): this {
    const document = this._held(documentId);
    this.documents.splice(
      this.documents.indexOf(document),
      1,
      change(document),
    );
    return this;
  }

  /** Edits a Doc just before a later `batchUpdate`, after `skipped` others, as an edit landing between a read and a write would. */
  editBeforeUpdate(change: DocumentChange, skipped = 0): this {
    this.pendingChange = { change, skipped };
    return this;
  }

  /** Applies every request or, on the first refused, none, as the API does. */
  batchUpdate(
    documentId: string,
    { requests, writeControl }: BatchUpdateRequest,
  ): Promise<void> {
    return Promise.resolve().then(() => {
      this._applyPendingChange(documentId);
      const document = this._held(documentId);
      if (writeControl.requiredRevisionId !== document.revisionId) {
        throw new DocsRequestRefused(
          400,
          `The required revision ${writeControl.requiredRevisionId} is not the latest.`,
        );
      }
      const { body, lists } = requests.reduce(
        (fake, request) => fake.apply(request),
        new FakeBody(document.body ?? { content: [] }, document.lists ?? {}),
      );
      this.revisionCount += 1;
      const revisionId = `${documentId}-written-${this.revisionCount}`;
      this.documents.splice(this.documents.indexOf(document), 1, {
        ...document,
        body,
        lists,
        revisionId,
      });
    });
  }

  private _applyPendingChange(documentId: string): void {
    const pending = this.pendingChange;
    if (pending === undefined) return;
    if (pending.skipped > 0) {
      pending.skipped -= 1;
      return;
    }
    this.pendingChange = undefined;
    this.edit(documentId, pending.change);
  }

  private _held(documentId: string): GoogleDocument {
    const document = this.documents.find(
      (held) => held.documentId === documentId,
    );
    if (document === undefined) {
      throw new Error(`No Doc ${documentId}.`);
    }
    return document;
  }
}

export type DocumentChange = (document: GoogleDocument) => GoogleDocument;

interface PendingChange {
  change: DocumentChange;
  skipped: number;
}

function indexed(document: GoogleDocument): GoogleDocument {
  const copy = structuredClone(document);
  if (copy.body !== undefined) {
    indexContent(copy.body.content, 0);
  }
  return copy;
}

/** Fills in the indices `documents.get` always sends and fixtures leave out; returns the end index. */
function indexContent(content: StructuralElement[], start: number): number {
  return content.reduce((index, element) => {
    element.startIndex = index;
    let end = index;
    if (element.sectionBreak !== undefined) {
      end = index + 1;
    }
    if (element.paragraph !== undefined) {
      end = element.paragraph.elements.reduce((elementStart, child) => {
        child.startIndex = elementStart;
        child.endIndex = elementStart + (child.textRun?.content.length ?? 1);
        return child.endIndex;
      }, index);
    }
    if (element.table !== undefined) {
      end = element.table.tableRows.reduce(
        (rowStart, row) =>
          row.tableCells.reduce(
            (cellStart, cell) => indexContent(cell.content, cellStart + 1),
            rowStart + 1,
          ),
        index + 1,
      );
    }
    element.endIndex = end;
    return end;
  }, start);
}
