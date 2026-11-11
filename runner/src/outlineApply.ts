// `npm run outline:apply`'s core: applies the Outline edits a developer's answer approves to a spec body, word for word,
// through the same code that answers a run's Research Halt, so an interactive /research-piece session never edits the
// spec body itself. It refuses a body that is Untrusted text, since the developer's login would make it read as Trusted.
// The edits and the answer's words are ./outlineEdits.ts; the entry, which reads the edits file, is scripts/runner/outlineApply.ts.

import { type IssueSource, untrustedBodyReasonOf } from "./IssueReader.ts";
import { type IssueRef, issueRef } from "./IssueWorkspaces.ts";
import { outlineEdits, outlineEditSchema } from "./outlineEdits.ts";
import { arraySchema, schemaProblemsOf } from "./recordSchema.ts";
import type { OutlineEdit } from "./stepRecords.ts";

export interface OutlineIssues extends IssueSource {
  editBody(issue: IssueRef, body: string): Promise<void>;
}

export interface OutlineApplyConfig {
  issues: OutlineIssues;
  developer: string;
}

export interface OutlineApplyRequest {
  spec: IssueRef;
  // The proposed edits, in the order that numbers them `E<n>`; unchecked, as an edits file's JSON.
  edits: unknown;
  answer: string;
}

export const outlineApply = {
  // The applied edits' words; throws, after applying what it could, when an approved edit couldn't be applied.
  async apply(
    { issues, developer }: OutlineApplyConfig,
    { spec, edits, answer }: OutlineApplyRequest,
  ): Promise<string> {
    const proposed = checkedEditsOf(edits);
    const approved = outlineEdits.approvedOf(answer, proposed);
    if (approved.length === 0) {
      throw new Error(
        `The answer approves no edit: name each as approve E<n>.`,
      );
    }
    const issue = await issues.readableIssueOf(spec);
    const reason = untrustedBodyReasonOf(developer, issue);
    if (reason !== undefined) {
      throw new Error(
        `${issueRef.labelOf(spec)}'s body is Untrusted text, ${reason}; approve its text before applying an edit.`,
      );
    }
    const { body, unapplied } = outlineEdits.applyTo(issue.body, approved);
    if (body !== issue.body) await issues.editBody(spec, body);
    const applied = approved.filter((edit) => !unapplied.includes(edit));
    const lines: string[] = [];
    if (applied.length > 0) {
      lines.push(
        `Applied ${outlineEdits.idsOf(proposed, applied)} to ${issueRef.labelOf(spec)}'s ## Outline.`,
      );
    }
    if (unapplied.length === 0) return lines.join(" ");
    lines.push(
      `Couldn't apply ${outlineEdits.idsOf(proposed, unapplied)}, whose ${outlineEdits.unappliedReason}; make it by hand: ${unapplied.map(outlineEdits.textOf).join("; ")}`,
    );
    throw new Error(lines.join(" "));
  },
};

function checkedEditsOf(edits: unknown): OutlineEdit[] {
  const problems = schemaProblemsOf(arraySchema(outlineEditSchema), edits);
  if (problems.length > 0) {
    throw new Error(
      `The edits aren't a list of Outline edits: ${problems.join("; ")}`,
    );
  }
  return edits as OutlineEdit[];
}
