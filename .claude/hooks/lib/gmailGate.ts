// Decides the gate for a gmail write: free when one signed-off Proposal in the /inbox data covers every label, criterion and id the call names, an ask otherwise. Pure; gmailGate.ts does the I/O.
import {
  type Decision,
  decisionInMode,
  gateOf,
  needsYes,
  type SessionMode,
} from "./tiers.ts";

export interface GmailCall {
  toolName: string;
  input: Record<string, unknown>;
  // The text of the /inbox skill's proposals.md and changes.md.
  proposals: string;
  changes: string;
  mode: SessionMode;
}

interface Proposal {
  id: string;
  text: string;
  kind: string;
  query: string;
  status: string;
  addText: string;
  // A label created on apply counts by the id changes.md records for its name.
  addIds: Set<string>;
  removeIds: Set<string>;
}

interface LabelChange {
  add: string[];
  remove: string[];
}

export const gmailWrites = new Set([
  "mcp__gmail__manage_gmail_filter",
  "mcp__gmail__manage_gmail_label",
  "mcp__gmail__modify_gmail_message_labels",
  "mcp__gmail__batch_modify_gmail_message_labels",
]);
const labelIdPattern =
  /\b(?:Label_\d+|INBOX|TRASH|SPAM|UNREAD|STARRED|IMPORTANT|CATEGORY_[A-Z]+)\b/g;
const labelChangeKeys = new Set(["addLabelIds", "removeLabelIds"]);

export function gmailGateDecision(call: GmailCall): Decision | undefined {
  if (!gmailWrites.has(call.toolName)) return undefined;
  return decisionInMode(baseDecision(call), call.mode);
}

export function unreadableDataDecision(mode: SessionMode): Decision {
  return decisionInMode(
    needsYes("the /inbox Proposal list can't be read"),
    mode,
  );
}

function baseDecision({
  toolName,
  input,
  proposals,
  changes,
}: GmailCall): Decision {
  const tool = toolName.replace("mcp__gmail__", "");
  if (labelChangeOf(input).add.includes("SPAM")) {
    return gateOf("deny", "the /inbox rules never mark mail as spam.");
  }
  const covering = proposalsOf(proposals, changes).find(
    (proposal) =>
      proposal.status === "signed-off" && covers(proposal, tool, input),
  );
  if (covering) {
    return gateOf(
      "allow",
      `signed-off ${covering.id} covers this \`${tool}\` call.`,
    );
  }
  return needsYes(`no signed-off Proposal covers this \`${tool}\` call`);
}

function covers(
  proposal: Proposal,
  tool: string,
  input: Record<string, unknown>,
): boolean {
  if (tool === "manage_gmail_filter") return coversFilter(proposal, input);
  if (tool === "manage_gmail_label") return coversLabel(proposal, input);
  if (!["bulk", "unsubscribe"].includes(proposal.kind)) return false;
  const change = labelChangeOf(input);
  return (
    change.add.length + change.remove.length > 0 &&
    coversLabelChange(proposal, change)
  );
}

function coversFilter(
  proposal: Proposal,
  input: Record<string, unknown>,
): boolean {
  if (input.action === "delete") {
    return (
      typeof input.filter_id === "string" &&
      proposal.text.includes(input.filter_id)
    );
  }
  if (proposal.kind !== "filter" || !isRecord(input.criteria)) return false;
  const action = input.filter_action;
  // A forward or any other action the Proposal format can't state stays an ask.
  if (
    !isRecord(action) ||
    !Object.keys(action).every((key) => labelChangeKeys.has(key))
  ) {
    return false;
  }
  const criteria = Object.values(input.criteria);
  const query = squashed(proposal.query);
  const change = {
    add: idsOf(action.addLabelIds),
    remove: idsOf(action.removeLabelIds),
  };
  return (
    criteria.length > 0 &&
    criteria.every(
      (value) => typeof value === "string" && query.includes(squashed(value)),
    ) &&
    change.add.length + change.remove.length > 0 &&
    coversLabelChange(proposal, change)
  );
}

function coversLabel(
  proposal: Proposal,
  input: Record<string, unknown>,
): boolean {
  const { action, name, label_id: labelId } = input;
  if (action === "create") {
    return typeof name === "string" && proposal.addText.includes(name);
  }
  if (proposal.kind !== "label") return false;
  return [labelId, name].some(
    (value) => typeof value === "string" && proposal.text.includes(value),
  );
}

function coversLabelChange(proposal: Proposal, change: LabelChange): boolean {
  return (
    change.add.every((id) => proposal.addIds.has(id)) &&
    change.remove.every((id) => proposal.removeIds.has(id))
  );
}

function labelChangeOf(input: Record<string, unknown>): LabelChange {
  const filterAction = isRecord(input.filter_action) ? input.filter_action : {};
  return {
    add: idsOf(input.add_label_ids ?? filterAction.addLabelIds),
    remove: idsOf(input.remove_label_ids ?? filterAction.removeLabelIds),
  };
}

function proposalsOf(proposals: string, changes: string): Proposal[] {
  const created = createdLabelsOf(changes);
  return entriesOf(proposals, /^## (P\d+):/m).map(([id, text]) => {
    const fields = fieldsOf(text);
    const action = fields.get("action") ?? "";
    // "add X; remove INBOX. A note" splits into its add and remove clauses.
    const clauses = action.split(/;|\.\s/).map((clause) => clause.trim());
    const addText = clauseOf(clauses, "add");
    return {
      id,
      text,
      kind: fields.get("kind") ?? "",
      query: fields.get("query") ?? "",
      status: fields.get("status") ?? "",
      addText,
      addIds: new Set([
        ...(addText.match(labelIdPattern) ?? []),
        ...created
          .filter((label) => addText.includes(label.name))
          .map((label) => label.id),
      ]),
      removeIds: new Set(clauseOf(clauses, "remove").match(labelIdPattern)),
    };
  });
}

function clauseOf(clauses: string[], verb: string): string {
  return clauses.filter((clause) => clause.startsWith(`${verb} `)).join(" ");
}

function createdLabelsOf(changes: string): { name: string; id: string }[] {
  return [...changes.matchAll(/created label (.+?) \(id (Label_\d+)\)/g)].map(
    (match) => ({ name: match[1] ?? "", id: match[2] ?? "" }),
  );
}

// Each heading's captured id with the text up to the next heading.
function entriesOf(text: string, heading: RegExp): [string, string][] {
  const parts = text.split(new RegExp(heading.source, "m"));
  const entries: [string, string][] = [];
  for (let i = 1; i < parts.length; i += 2) {
    entries.push([parts[i] ?? "", parts[i + 1] ?? ""]);
  }
  return entries;
}

function fieldsOf(text: string): Map<string, string> {
  return new Map(
    [...text.matchAll(/^- ([a-z][a-z -]*): (.*)$/gm)].map((match) => [
      match[1] ?? "",
      (match[2] ?? "").trim(),
    ]),
  );
}

function idsOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === "string")
    : [];
}

function squashed(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
