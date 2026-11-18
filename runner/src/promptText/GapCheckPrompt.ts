// The spec's gap-check prompt: the shared frame around the section of each Workflow its tickets use, so each story is checked where its work is.
// Each section is its Workflow's, in Workflow/<name>/gapCheck.ts; ../Workflow.ts's gapCheckInputOf builds the input, and ../SpecRun/SpecEndRunner.ts launches it.

import { stepReadLine } from "../IssueReader.ts";
import { issueRef } from "../IssueWorkspaces.ts";
import { sectionOf, stepOpeningOf, unattendedRunLine } from "../promptText.ts";
import type {
  GapCheckPromptInput,
  GapCheckSection,
  GapCheckTicket,
} from "../Workflow.ts";

export class GapCheckPrompt {
  private readonly input: GapCheckPromptInput;

  constructor(input: GapCheckPromptInput) {
    this.input = input;
  }

  static init(input: GapCheckPromptInput): GapCheckPrompt {
    return new GapCheckPrompt(input);
  }

  get text(): string {
    const { spec, title, tickets, sections } = this.input;
    return [
      `${stepOpeningOf("gap check")} ${unattendedRunLine()}

Every ticket of the spec ${spec.repo}#${spec.number}, "${title}", has landed or closed${this._heldOpenClause}. List what the spec asks for that its tickets' work doesn't give. Your working directory is the primary root, on master. ${stepReadLine}`,
      sectionOf("How you check", [
        "Read the spec's body and its comments: an addendum the developer posted as a comment changes the spec.",
        "Each User Story and each Implementation Decision is something the spec asks for, and so is each ask of an addendum. Skip what the spec no longer asks for: every story or section an addendum drops.",
        `Check a story a ticket took where that ticket's work is, by its Workflow below. Check a story no ticket took, whether no ticket names it or the ticket that did was closed as not planned, ${this._placesClause}.`,
        "A gap is something the spec still asks for that the work doesn't give. Work that covers it differently from how the spec words it is no gap.",
      ]),
      ...sections.map(workflowSectionOf),
      "Change nothing: no edits, commits, comments or issues. The runner posts your gaps as the spec's last review list; it never files the drafted follow-ups.",
      this._recordSection,
      `## The spec's tickets\n\nEach ticket names its Workflow.\n\n${tickets.map((ticket) => this._ticketLineOf(ticket)).join("\n")}`,
    ].join("\n\n");
  }

  private get _heldOpenClause(): string {
    const held = this.input.sections.flatMap(({ heldOpen }) =>
      heldOpen === undefined
        ? []
        : [`${heldOpen.name}, ${heldOpen.description}`],
    );
    if (held.length === 0) return "";
    return `, but ${held.join(" and ")}`;
  }

  private get _placesClause(): string {
    const places = this.input.sections.map(({ place }) => place);
    if (places.length === 1) return `against ${places.join("")}`;
    return `against each of ${places.join(" and ")}`;
  }

  // A gap's follow-up is the kind its place drafts.
  private get _recordSection(): string {
    return `## The record\n\nReturn \`gaps\`, one per gap, or an empty list when you find none: \`ask\` (what the spec asked for, by its story number, its section or the addendum's words), \`evidence\` (what you checked and found missing), \`recommendation\` (what you recommend the developer do) and \`draftIssueTitle\` (${this._followUpTitle}).`;
  }

  private get _followUpTitle(): string {
    const { sections } = this.input;
    const [only] = sections;
    if (sections.length === 1 && only !== undefined) {
      return `the title of ${only.followUp} that would close it`;
    }
    const kinds = sections.map(
      ({ followUp, place }) => `${followUp} for a gap in ${place}`,
    );
    return `the title of the follow-up that would close it: ${kinds.join(", or ")}`;
  }

  // Marked with the ticket's Workflow, and an open ticket with the name its Workflow's section gives it.
  private _ticketLineOf({
    issue,
    title,
    isOpen,
    workflow,
  }: GapCheckTicket): string {
    const marks: string[] = workflow === undefined ? [] : [workflow];
    if (isOpen) {
      const heldOpen = this.input.sections.find(
        (section) => section.workflow === workflow,
      )?.heldOpen;
      marks.push(heldOpen === undefined ? "open" : `open: ${heldOpen.name}`);
    }
    const line = `- ${issueRef.labelOf(issue)}, "${title}"`;
    return marks.length === 0 ? line : `${line} (${marks.join("; ")})`;
  }
}

function workflowSectionOf({
  workflow,
  place,
  checks,
  followUp,
}: GapCheckSection): string {
  return sectionOf(`The ${workflow} tickets' work: ${place}`, [
    ...checks,
    `A gap there drafts ${followUp}.`,
  ]);
}
