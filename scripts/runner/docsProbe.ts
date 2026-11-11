// `npm run google:script -- scripts/runner/docsProbe.ts <command> <outDir> <docId> [args…]`: probes the Docs REST API and the
// Docs module on a scratch Doc as the agent account. Each command saves its `documents.get` reads, suggestions inline, as
// numbered JSON in <outDir>, and prints each as one line per paragraph and as the reader's Markdown.
//   reset                     clears the body and refills it with the fixture below: headings, nested numbered and bulleted lists, a footnote, a 2x2 table.
//   read                      reads it, such as after the developer leaves suggestions on it.
//   write <heading> <md file> writes that Section through the Docs module.
//   batch <requests file>     sends a JSON array of raw `batchUpdate` requests under the read's revision, printing the replies.
// The Docs module scratch Doc's ID is in packages/personal/private/google.md; what a probe sees goes in docs/google-docs-behaviour.md.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { Docs } from "@byronbroughten/spec-runner/Docs";
import type {
  BatchUpdateRequest,
  DocumentsPort,
  GoogleDocument,
  NamedStyleType,
  ParagraphElement,
  StructuralElement,
} from "@byronbroughten/spec-runner/googleDocs";

const usage =
  "Usage: npm run google:script -- scripts/runner/docsProbe.ts <reset|read|write|batch> <outDir> <docId> [<heading> <markdown file> | <requests file>]";
const documentsUrl = "https://docs.googleapis.com/v1/documents";

/** A raw `batchUpdate` request, any kind the API takes, not only the ones the Docs module sends. */
type RawRequest = Record<string, unknown>;

interface BatchReply {
  replies?: RawRequest[];
}

/** The fixture `reset` writes, one paragraph each; a leading tab nests a list item. */
const fixture: [NamedStyleType, string][] = [
  ["HEADING_2", "Steps"],
  ["NORMAL_TEXT", "Fill the kettle."],
  ["NORMAL_TEXT", "\tCold water only."],
  ["NORMAL_TEXT", "\tNot past the line."],
  ["NORMAL_TEXT", "Switch it on."],
  ["NORMAL_TEXT", "Wait for the click."],
  ["HEADING_2", "Kinds"],
  ["NORMAL_TEXT", "Stovetop"],
  ["NORMAL_TEXT", "\tWhistling"],
  ["NORMAL_TEXT", "\t\tBase only"],
  ["NORMAL_TEXT", "Electric"],
  ["HEADING_2", "Costs"],
  ["NORMAL_TEXT", "Three kettles compared."],
  ["NORMAL_TEXT", "Steel wins on price."],
  ["HEADING_2", "Scale"],
  ["NORMAL_TEXT", "Hard water leaves scale inside."],
  ["HEADING_2", "Storage"],
  ["NORMAL_TEXT", "Empty the kettle after use."],
  ["NORMAL_TEXT", "A handle stays cool. Most of the time."],
  ["NORMAL_TEXT", "Store it dry."],
  ["HEADING_2", "Target"],
  ["NORMAL_TEXT", "Old target text."],
];

const zeroIndent = { magnitude: 0, unit: "PT" } as const;

class DocsProbe implements DocumentsPort {
  private readonly token: string;
  private readonly outDir: string;
  private readonly documentId: string;
  private saved = 0;

  constructor(token: string, outDir: string, documentId: string) {
    this.token = token;
    this.outDir = outDir;
    this.documentId = documentId;
  }

  static init(outDir: string, documentId: string): DocsProbe {
    const token = process.env.GOOGLE_ACCESS_TOKEN;
    if (token === undefined) {
      throw new Error(`No GOOGLE_ACCESS_TOKEN. ${usage}`);
    }
    mkdirSync(outDir, { recursive: true });
    return new DocsProbe(token, outDir, documentId);
  }

  async documentOf(documentId: string): Promise<GoogleDocument> {
    return (await this._sent(
      "GET",
      `${documentsUrl}/${encodeURIComponent(documentId)}?suggestionsViewMode=SUGGESTIONS_INLINE`,
    )) as GoogleDocument;
  }

  async batchUpdate(
    documentId: string,
    update: BatchUpdateRequest,
  ): Promise<void> {
    await this._batch(documentId, update);
  }

  async reset(): Promise<void> {
    await this._cleared();
    await this._fill();
    await this._bulleted();
    await this._footnoted();
    await this._tabled();
    await this.read("reset");
  }

  async read(name: string): Promise<GoogleDocument> {
    const document = await this.documentOf(this.documentId);
    const path = this._save(name, document);
    const { markdown } = await Docs.init({
      async documentOf() {
        return document;
      },
      async batchUpdate() {},
    }).read(this.documentId);
    console.log(
      `${name}, saved as ${path}:\n${outlineOf(document)}\nReads as:\n${markdown}\n`,
    );
    return document;
  }

  async write(heading: string, markdownFile: string): Promise<void> {
    await this.read("before-write");
    const docs = Docs.init(this);
    await docs.read(this.documentId);
    await docs.writeSection({
      documentId: this.documentId,
      heading,
      markdown: readFileSync(markdownFile, "utf8"),
    });
    await this.read("after-write");
  }

  async batch(requestsFile: string): Promise<void> {
    const before = await this.read("before-batch");
    const requests = JSON.parse(readFileSync(requestsFile, "utf8")) as unknown;
    if (!Array.isArray(requests)) {
      throw new Error(`${requestsFile} holds no JSON array of requests.`);
    }
    const reply = await this._batch(this.documentId, {
      requests,
      writeControl: { requiredRevisionId: before.revisionId },
    });
    console.log(`Replies: ${JSON.stringify(reply.replies ?? [])}\n`);
    await this.read("after-batch");
  }

  private async _cleared(): Promise<void> {
    const content = await this._contentOf();
    const end = (content.at(-1)?.endIndex ?? 2) - 1;
    if (end <= 1) {
      return;
    }
    await this._send([
      { deleteContentRange: { range: { startIndex: 1, endIndex: end } } },
    ]);
  }

  private async _fill(): Promise<void> {
    const text = fixture.map(([, line]) => line).join("\n");
    const whole = { startIndex: 1, endIndex: 1 + text.length + 1 };
    const requests: RawRequest[] = [
      { insertText: { text, location: { index: 1 } } },
      { deleteParagraphBullets: { range: whole } },
    ];
    let index = 1;
    for (const [namedStyleType, line] of fixture) {
      const end = index + line.length + 1;
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: index, endIndex: end },
          paragraphStyle: {
            namedStyleType,
            indentStart: zeroIndent,
            indentFirstLine: zeroIndent,
          },
          fields: "namedStyleType,indentStart,indentFirstLine",
        },
      });
      index = end;
    }
    await this._send(requests);
  }

  /** The later list first, since a list's leading tabs go and shift what follows. */
  private async _bulleted(): Promise<void> {
    const content = await this._contentOf();
    await this._send([
      {
        createParagraphBullets: {
          range: rangeOf(content, "Stovetop", "Electric"),
          bulletPreset: "BULLET_DISC_CIRCLE_SQUARE",
        },
      },
      {
        createParagraphBullets: {
          range: rangeOf(content, "Fill the kettle.", "Switch it on."),
          bulletPreset: "NUMBERED_DECIMAL_ALPHA_ROMAN",
        },
      },
    ]);
  }

  private async _footnoted(): Promise<void> {
    const scale = paragraphOf(
      await this._contentOf(),
      "Hard water leaves scale inside.",
    );
    const reply = await this._send([
      {
        createFootnote: {
          location: {
            index: startOf(scale) + "Hard water leaves scale".length,
          },
        },
      },
    ]);
    const created = reply.replies?.[0]?.createFootnote as
      { footnoteId: string } | undefined;
    if (created === undefined) {
      throw new Error("createFootnote replied with no footnoteId.");
    }
    await this._send([
      {
        insertText: {
          text: "Mostly calcium.",
          endOfSegmentLocation: { segmentId: created.footnoteId },
        },
      },
    ]);
  }

  /** The cells' text goes in last cell first, so earlier cells' indices hold. */
  private async _tabled(): Promise<void> {
    const compared = paragraphOf(
      await this._contentOf(),
      "Three kettles compared.",
    );
    await this._send([
      {
        insertTable: {
          rows: 2,
          columns: 2,
          location: { index: endOf(compared) - 1 },
        },
      },
    ]);
    const table = (await this._contentOf()).find(
      (element) => element.table !== undefined,
    );
    const cells = (table?.table?.tableRows ?? []).flatMap(
      (row) => row.tableCells,
    );
    const texts = ["Kettle", "Price", "Copper", "High"];
    const requests = cells.map((cell, position) => ({
      insertText: {
        text: texts[position],
        location: { index: startOf(cell.content[0]) },
      },
    }));
    await this._send(requests.reverse());
  }

  private async _contentOf(): Promise<StructuralElement[]> {
    return (await this.documentOf(this.documentId)).body?.content ?? [];
  }

  private async _send(requests: RawRequest[]): Promise<BatchReply> {
    return this._batch(this.documentId, { requests });
  }

  private async _batch(
    documentId: string,
    update: { requests: unknown[]; writeControl?: object },
  ): Promise<BatchReply> {
    return (await this._sent(
      "POST",
      `${documentsUrl}/${encodeURIComponent(documentId)}:batchUpdate`,
      update,
    )) as BatchReply;
  }

  private async _sent(
    method: "GET" | "POST",
    url: string,
    body?: unknown,
  ): Promise<unknown> {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `Docs API ${response.status} for ${method} ${url}: ${text}`,
      );
    }
    return JSON.parse(text);
  }

  private _save(name: string, document: GoogleDocument): string {
    this.saved += 1;
    const path = join(
      this.outDir,
      `${String(this.saved).padStart(2, "0")}-${name}.json`,
    );
    writeFileSync(path, JSON.stringify(document, null, 2));
    return path;
  }
}

/** One line per body element: its indices, then a table's size, or a paragraph's style, headingId, list and level, and text with suggested runs marked. */
function outlineOf(document: GoogleDocument): string {
  return (document.body?.content ?? [])
    .flatMap((element) => {
      const at = `  [${element.startIndex}-${element.endIndex}]`;
      if (element.table !== undefined) {
        return [`${at} TABLE ${element.table.rows}x${element.table.columns}`];
      }
      if (element.paragraph === undefined) {
        return [];
      }
      const { paragraphStyle = {}, bullet, elements } = element.paragraph;
      let list = "";
      if (bullet !== undefined) {
        list = ` list=${bullet.listId}@${bullet.nestingLevel ?? 0}`;
      }
      const text = elements.map(markedTextOf).join("");
      return [
        `${at} ${paragraphStyle.namedStyleType} ${paragraphStyle.headingId ?? "-"}${list} ${JSON.stringify(text)}`,
      ];
    })
    .join("\n");
}

function markedTextOf({
  textRun,
  footnoteReference,
}: ParagraphElement): string {
  if (textRun === undefined) {
    if (footnoteReference === undefined) {
      return "[?]";
    }
    return `[fn${footnoteReference.footnoteNumber}]`;
  }
  const marks = [
    textRun.suggestedInsertionIds === undefined ? "" : "+ins",
    textRun.suggestedDeletionIds === undefined ? "" : "+del",
  ].join("");
  if (marks === "") {
    return textRun.content;
  }
  return `{${marks}:${textRun.content}}`;
}

function paragraphOf(
  content: StructuralElement[],
  text: string,
): StructuralElement {
  const found = content.find(
    (element) =>
      element.paragraph?.elements
        .map((paragraphElement) => paragraphElement.textRun?.content ?? "")
        .join("") === `${text}\n`,
  );
  if (found === undefined) {
    throw new Error(`No paragraph reads "${text}".`);
  }
  return found;
}

function rangeOf(
  content: StructuralElement[],
  first: string,
  last: string,
): { startIndex: number; endIndex: number } {
  return {
    startIndex: startOf(paragraphOf(content, first)),
    endIndex: endOf(paragraphOf(content, last)),
  };
}

function startOf(element: StructuralElement | undefined): number {
  if (element?.startIndex === undefined) {
    throw new Error("A body element came back with no startIndex.");
  }
  return element.startIndex;
}

function endOf(element: StructuralElement): number {
  if (element.endIndex === undefined) {
    throw new Error("A body element came back with no endIndex.");
  }
  return element.endIndex;
}

// npm runs google:script from the root's folder, so a relative path is read from the folder npm was called from.
function pathOf(path: string): string {
  return resolve(process.env.INIT_CWD ?? process.cwd(), path);
}

try {
  const [command, outDir, documentId, ...args] = process.argv.slice(2);
  if (outDir === undefined || documentId === undefined) {
    throw new Error(usage);
  }
  const probe = DocsProbe.init(pathOf(outDir), documentId);
  const [first, second, ...rest] = args;
  if (command === "reset" && first === undefined) {
    await probe.reset();
  } else if (command === "read" && first === undefined) {
    await probe.read("read");
  } else if (
    command === "write" &&
    first !== undefined &&
    second !== undefined &&
    rest.length === 0
  ) {
    await probe.write(first, pathOf(second));
  } else if (
    command === "batch" &&
    first !== undefined &&
    second === undefined
  ) {
    await probe.batch(pathOf(first));
  } else {
    throw new Error(usage);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
