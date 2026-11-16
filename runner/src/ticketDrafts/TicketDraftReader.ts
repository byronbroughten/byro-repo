// Reads one draft file into a TicketDraft, naming the file in each refusal; the drafts' order and the refusals across
// drafts are ../ticketDrafts.ts's.

import {
  heldLabel,
  humanLabel,
  interactiveLabel,
  readyLabel,
} from "../SpecRun/runState.ts";
import type { DraftFile, TicketDraft } from "../ticketDrafts.ts";

const triageLabelOfKind = {
  agent: readyLabel,
  interactive: interactiveLabel,
  human: humanLabel,
} as const;
type DraftKind = keyof typeof triageLabelOfKind;

// docs/agents/triage-labels.md's six.
const triageLabels = new Set([
  heldLabel,
  "needs-info",
  readyLabel,
  interactiveLabel,
  humanLabel,
  "wontfix",
]);
const frontMatterKeys = new Set(["title", "kind", "labels", "blockers"]);
const draftFileName = /^(\d+)(?:-[^/]*)?\.md$/;
const frontMatterBlock = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/;

export class TicketDraftReader {
  private readonly file: DraftFile;

  constructor(file: DraftFile) {
    this.file = file;
  }

  static init(file: DraftFile): TicketDraftReader {
    return new TicketDraftReader(file);
  }

  get draft(): TicketDraft {
    const { fileName, text } = this.file;
    const numberMatch = draftFileName.exec(fileName);
    if (!numberMatch) {
      throw new Error(
        `${fileName} isn't a draft's name, which is <n>.md or <n>-<slug>.md.`,
      );
    }
    const block = frontMatterBlock.exec(text);
    if (!block) {
      throw new Error(
        `${fileName} opens with no front matter between --- lines.`,
      );
    }
    const fields = this._fieldsOf(block[1] ?? "");
    const title = fields.get("title") ?? "";
    if (!title) throw new Error(`${fileName}'s front matter has no title.`);
    const body = (block[2] ?? "").trim();
    if (!body) {
      throw new Error(`${fileName} has no body below its front matter.`);
    }
    return {
      number: Number(numberMatch[1]),
      fileName,
      title,
      labels: [
        triageLabelOfKind[this._kindOf(fields.get("kind"))],
        ...this._otherLabelsOf(listOf(fields.get("labels"))),
      ],
      blockers: this._blockersOf(listOf(fields.get("blockers"))),
      body,
    };
  }

  private _fieldsOf(frontMatter: string): Map<string, string> {
    const fields = new Map<string, string>();
    for (const line of frontMatter.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const separator = line.indexOf(":");
      const key = line.slice(0, separator).trim();
      if (separator < 0 || !frontMatterKeys.has(key)) {
        throw new Error(
          `${this.file.fileName}'s front matter line "${line}" isn't one of ${[...frontMatterKeys].join(", ")}.`,
        );
      }
      if (fields.has(key)) {
        throw new Error(
          `${this.file.fileName}'s front matter gives ${key} twice.`,
        );
      }
      fields.set(key, line.slice(separator + 1).trim());
    }
    return fields;
  }

  private _kindOf(kind = ""): DraftKind {
    if (Object.hasOwn(triageLabelOfKind, kind)) return kind as DraftKind;
    throw new Error(
      `${this.file.fileName}'s kind "${kind}" isn't one of ${Object.keys(triageLabelOfKind).join(", ")}.`,
    );
  }

  private _otherLabelsOf(labels: string[]): string[] {
    const triage = labels.find((label) => triageLabels.has(label));
    if (triage !== undefined) {
      throw new Error(
        `${this.file.fileName} lists the triage label ${triage} among its labels; its kind supplies the triage label.`,
      );
    }
    return labels;
  }

  private _blockersOf(blockers: string[]): number[] {
    const notNumbers = blockers.filter((blocker) => !/^\d+$/.test(blocker));
    if (notNumbers.length > 0) {
      throw new Error(
        `${this.file.fileName}'s blockers ${notNumbers.join(", ")} aren't draft numbers.`,
      );
    }
    return blockers.map(Number);
  }
}

function listOf(value = ""): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}
