// The Google Docs layer's types: the `documents.get` body types the reader reads
// and the port that fetches one, which `RestDocuments.ts` implements over the
// REST API. Property names mirror the Docs REST API's wire shape.
// Nothing here knows Markdown; the dialect is `markdownDialect.ts`, and the
// reader joining the two is `DocReader.ts`.

export interface GoogleDocument {
  documentId: string;
  title?: string;
  revisionId: string;
  body?: Body;
  lists?: Record<string, List>;
  footnotes?: Record<string, Footnote>;
  tabs?: Tab[];
}

export interface Tab {
  tabProperties?: { tabId: string; title?: string };
  documentTab?: DocumentTab;
}

export interface DocumentTab {
  body: Body;
  lists?: Record<string, List>;
  footnotes?: Record<string, Footnote>;
}

export interface Body {
  content: StructuralElement[];
}

export interface StructuralElement {
  startIndex?: number;
  endIndex?: number;
  paragraph?: Paragraph;
  table?: Table;
  sectionBreak?: object;
  tableOfContents?: object;
}

export interface Paragraph {
  elements: ParagraphElement[];
  paragraphStyle?: ParagraphStyle;
  bullet?: Bullet;
}

export type NamedStyleType =
  | "NORMAL_TEXT"
  | "TITLE"
  | "SUBTITLE"
  | "HEADING_1"
  | "HEADING_2"
  | "HEADING_3"
  | "HEADING_4"
  | "HEADING_5"
  | "HEADING_6";

export interface ParagraphStyle {
  namedStyleType?: NamedStyleType;
  headingId?: string;
  indentStart?: Dimension;
  indentFirstLine?: Dimension;
}

export interface Dimension {
  magnitude?: number;
  unit?: "PT";
}

export interface Bullet {
  listId: string;
  nestingLevel?: number;
}

export interface ParagraphElement {
  startIndex?: number;
  endIndex?: number;
  textRun?: TextRun;
  footnoteReference?: FootnoteReference;
}

export interface TextRun {
  content: string;
  textStyle?: TextStyle;
  suggestedInsertionIds?: string[];
  suggestedDeletionIds?: string[];
}

export interface TextStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  link?: Link;
}

export interface Link {
  url?: string;
  heading?: { id: string; tabId?: string };
  headingId?: string;
  bookmark?: { id: string; tabId?: string };
}

export interface FootnoteReference {
  footnoteId: string;
  footnoteNumber: string;
  suggestedInsertionIds?: string[];
}

export interface Footnote {
  footnoteId: string;
  content: StructuralElement[];
}

export interface List {
  listProperties: { nestingLevels: NestingLevel[] };
}

export interface NestingLevel {
  glyphType?: string;
  glyphSymbol?: string;
  indentStart?: Dimension;
  indentFirstLine?: Dimension;
}

export interface Table {
  rows: number;
  columns: number;
  tableRows: TableRow[];
  suggestedInsertionIds?: string[];
  suggestedDeletionIds?: string[];
}

export interface TableRow {
  tableCells: TableCell[];
}

export interface TableCell {
  content: StructuralElement[];
}

/** One `documents.batchUpdate` request; each carries exactly one kind. */
export interface Request {
  insertText?: InsertTextRequest;
  deleteContentRange?: { range: Range };
  updateTextStyle?: UpdateTextStyleRequest;
  updateParagraphStyle?: UpdateParagraphStyleRequest;
  createParagraphBullets?: CreateParagraphBulletsRequest;
  deleteParagraphBullets?: { range: Range };
  insertTable?: InsertTableRequest;
}

/** The presets the writer uses: one bulleted, one numbered. */
export type BulletPreset =
  "BULLET_DISC_CIRCLE_SQUARE" | "NUMBERED_DECIMAL_ALPHA_ROMAN";

export interface CreateParagraphBulletsRequest {
  range: Range;
  bulletPreset: BulletPreset;
}

/** Inserts a newline at the index, then an empty table after it. */
export interface InsertTableRequest {
  rows: number;
  columns: number;
  location: { index: number };
}

export interface Range {
  startIndex: number;
  endIndex: number;
}

export interface InsertTextRequest {
  text: string;
  location: { index: number };
}

export interface UpdateTextStyleRequest {
  range: Range;
  textStyle: TextStyle;
  fields: string;
}

export interface UpdateParagraphStyleRequest {
  range: Range;
  paragraphStyle: ParagraphStyle;
  fields: string;
}

export interface BatchUpdateRequest {
  requests: Request[];
  writeControl: { requiredRevisionId: string };
}

/**
 * The port to the Docs REST API's `documents.get` and `documents.batchUpdate`,
 * real or faked. A refused request rejects with `DocsRequestRefused`.
 */
export interface DocumentsPort {
  documentOf(documentId: string): Promise<GoogleDocument>;
  batchUpdate(documentId: string, update: BatchUpdateRequest): Promise<void>;
}
