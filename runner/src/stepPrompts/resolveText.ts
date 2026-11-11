// The resolve text every Workflow's resolve prompt shares, and the implement body and /implement-code skill reuse (resolveRules, resolveRecordFields).

import { codeListOf } from "../promptText.ts";
import { numberedFindingsOf } from "../resolveRecords.ts";
import {
  dismissReasons,
  type Finding,
  proposeReasons,
} from "../stepRecords.ts";
import type { ResolvePromptInput } from "../Workflow.ts";

// How any resolver judges, shared with the implementer through implementBody.resolving.
export const resolveRules =
  "Give each finding exactly one verdict, Dismiss, Fix, Propose or Halt, by the rules in `docs/agents/verdicts.md`; read it before you judge. Fix by default, and Dismiss, Propose or Halt only where that doc says, with evidence. You may overrule a reviewer's suggested verdict, saying why in `evidence`, except that a suggested Halt resolves only as a Halt or a Propose `decision`. The Fixes land together in one commit, its message naming each finding by number.";

// The resolve prompt's and the /implement-code skill's one description of a record, after "Return `records`, ".
export const resolveRecordFields = `exactly one record per finding: \`finding\` (its number in the list), \`axis\` (the finding's own, or for a finding without one, \`standards\` or \`spec\`), \`where\` (its file:line or area), \`claim\` (what the finding says, in a line), \`verdict\` (\`dismiss\`, \`fix\`, \`propose\` or \`halt\`), \`evidence\` (what you checked and found, and why, when you overruled the suggested verdict), and the fields its verdict needs:

- **Dismiss**: \`reason\`, one of ${codeListOf(dismissReasons)}; for \`covered-later\`, \`coveredBy\`, the later ticket as \`<repo>#<n>\`; for \`kept\`, \`quote\`, the site's reason with its file:line.
- **Fix**: \`quote\`, the quoted code or text, with its file:line, and \`rule\`, the documented rule or spec line it breaks.
- **Propose**: \`reason\`, ${codeListOf(proposeReasons)}, and \`recommendation\`; for \`ticket\`, \`draftIssueTitle\`; for a \`decision\` asking the developer's yes to a new keep, \`draftKeepReason\`, the drafted one-line reason.
- **Halt**: \`recommendation\`, and \`haltScope\`, the later tickets it blocks as \`<repo>#<n>\`, or \`spec\`; omit it to block the whole spec.`;

// The text every Workflow's resolve prompt shares; each Workflow's prompt adds its own opening and how it fixes.
export const resolveBody = {
  findingsOf({ issue, title }: Pick<ResolvePromptInput, "issue" | "title">) {
    return `The review of ${issue.repo}#${issue.number}, "${title}", reported the findings below, each with its axis and its reviewer's suggested verdict. ${resolveRules}`;
  },
  commitNothing: "Commit nothing when no finding is a Fix.",
  revertedAs:
    "is reverted in a further commit and resolved, saying why, as a Propose `decision`, or for a `spec`-axis finding as a Halt scoped to the downstream tickets.",
  onlyWrites:
    "Never amend, push, merge, rebase or reset, never comment on, file or close an issue, and never run the wrap-up. The runner acts on your Propose and Halt verdicts.",
  recordAndFindingsOf(findings: Finding[]) {
    return `## The record\n\nReturn \`records\`, ${resolveRecordFields}\n\n## Findings\n\n${numberedFindingsOf(findings)}`;
  },
} as const;
