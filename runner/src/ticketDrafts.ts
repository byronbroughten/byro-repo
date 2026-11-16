// `npm run issue:file`'s draft format, its order and its refusals; the format is documented in docs/agents/issue-tracker.md.

export interface DraftFile {
  fileName: string;
  text: string;
}

export interface TicketDraft {
  number: number;
  fileName: string;
  title: string;
  // The kind's triage label first.
  labels: string[];
  blockers: number[];
  body: string;
}

const triageLabelOfKind = {
  agent: "ready-for-agent",
  interactive: "ready-for-interactive",
  human: "ready-for-human",
} as const;
type DraftKind = keyof typeof triageLabelOfKind;

// docs/agents/triage-labels.md's six.
const triageLabels = new Set([
  "needs-triage",
  "needs-info",
  "ready-for-agent",
  "ready-for-interactive",
  "ready-for-human",
  "wontfix",
]);
const frontMatterKeys = new Set(["title", "kind", "labels", "blockers"]);
const draftFileName = /^(\d+)(?:-[^/]*)?\.md$/;
const frontMatterBlock = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/;

export const ticketDrafts = {
  // In draft order, refusing any draft that can't file and any blocker number with no draft.
  draftsOf(files: DraftFile[]): TicketDraft[] {
    if (files.length === 0) throw new Error("The folder holds no drafts.");
    const drafts = files.map(draftOfFile).sort((a, b) => a.number - b.number);
    for (const [at, draft] of drafts.entries()) {
      const earlier = drafts[at - 1];
      if (earlier?.number === draft.number) {
        throw new Error(
          `${draft.fileName} has draft number ${draft.number}, as ${earlier.fileName} does.`,
        );
      }
    }
    const numbers = new Set(drafts.map(({ number }) => number));
    for (const draft of drafts) {
      const missing = draft.blockers.filter((blocker) => !numbers.has(blocker));
      if (missing.length > 0) {
        throw new Error(
          `${draft.fileName} is blocked by draft ${missing.join(", ")}, which the folder doesn't hold.`,
        );
      }
    }
    return drafts;
  },
  // Each blocker before the drafts naming it, otherwise in draft order.
  filingOrderOf(drafts: TicketDraft[]): TicketDraft[] {
    const filed = new Set<number>();
    const order: TicketDraft[] = [];
    let waiting = drafts;
    while (waiting.length > 0) {
      const next = waiting.find(({ blockers }) =>
        blockers.every((blocker) => filed.has(blocker)),
      );
      if (next === undefined) throw new Error(cycleMessageOf(waiting));
      filed.add(next.number);
      order.push(next);
      waiting = waiting.filter((draft) => draft !== next);
    }
    return order;
  },
};

function draftOfFile({ fileName, text }: DraftFile): TicketDraft {
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
  const fields = fieldsOf(fileName, block[1] ?? "");
  const title = fields.get("title") ?? "";
  if (!title) throw new Error(`${fileName}'s front matter has no title.`);
  const body = (block[2] ?? "").trim();
  if (!body) throw new Error(`${fileName} has no body below its front matter.`);
  return {
    number: Number(numberMatch[1]),
    fileName,
    title,
    labels: [
      triageLabelOfKind[kindOf(fileName, fields.get("kind"))],
      ...otherLabelsOf(fileName, listOf(fields.get("labels"))),
    ],
    blockers: blockersOf(fileName, listOf(fields.get("blockers"))),
    body,
  };
}

function fieldsOf(fileName: string, frontMatter: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of frontMatter.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const separator = line.indexOf(":");
    const key = line.slice(0, separator).trim();
    if (separator < 0 || !frontMatterKeys.has(key)) {
      throw new Error(
        `${fileName}'s front matter line "${line}" isn't one of ${[...frontMatterKeys].join(", ")}.`,
      );
    }
    if (fields.has(key)) {
      throw new Error(`${fileName}'s front matter gives ${key} twice.`);
    }
    fields.set(key, line.slice(separator + 1).trim());
  }
  return fields;
}

function kindOf(fileName: string, kind = ""): DraftKind {
  if (Object.hasOwn(triageLabelOfKind, kind)) return kind as DraftKind;
  throw new Error(
    `${fileName}'s kind "${kind}" isn't one of ${Object.keys(triageLabelOfKind).join(", ")}.`,
  );
}

function listOf(value = ""): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function otherLabelsOf(fileName: string, labels: string[]): string[] {
  const triage = labels.find((label) => triageLabels.has(label));
  if (triage !== undefined) {
    throw new Error(
      `${fileName} lists the triage label ${triage} among its labels; its kind supplies the triage label.`,
    );
  }
  return labels;
}

function blockersOf(fileName: string, blockers: string[]): number[] {
  const notNumbers = blockers.filter((blocker) => !/^\d+$/.test(blocker));
  if (notNumbers.length > 0) {
    throw new Error(
      `${fileName}'s blockers ${notNumbers.join(", ")} aren't draft numbers.`,
    );
  }
  return blockers.map(Number);
}

// Every draft left waiting is in a cycle or waits on one, so the message trims those that block or wait on no other kept draft.
function cycleMessageOf(waiting: TicketDraft[]): string {
  let inCycle = waiting;
  let isShrinking = true;
  while (isShrinking) {
    const keptNumbers = new Set(inCycle.map(({ number }) => number));
    const blocking = new Set(inCycle.flatMap(({ blockers }) => blockers));
    const kept = inCycle.filter(
      ({ number, blockers }) =>
        blocking.has(number) &&
        blockers.some((blocker) => keptNumbers.has(blocker)),
    );
    isShrinking = kept.length < inCycle.length;
    inCycle = kept;
  }
  const names = inCycle.map(({ fileName }) => fileName).join(", ");
  return `The drafts' blockers form a cycle among ${names}.`;
}
