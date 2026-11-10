// The prompt text the implement and resolve steps share with the core and with the /implement-code skill: the resumes'
// prompts, the shared body of the implement prompt and the resolve rules and record fields. Each step's own prompt stays in its file.

import { codeListOf, sectionOf } from "./promptText.ts";
import {
  dismissReasons,
  type ProposedSlice,
  proposeReasons,
} from "./stepRecords.ts";

// Sent with --resume once a step crosses the live ceiling without handing off.
export const handoffOnlyPrompt =
  "Stop now; return a handoff record only, no file changes.";

// Sent with --resume on a `retry record` answer, after a record failed its check once the step had committed.
export const recordOnlyPrompt =
  "Your implement record failed the runner's check. Change no files: return the implement record again, matching the schema, with each branch's current sha. Nobody is watching this session: never ask a question or wait for an answer.";

export const treeResetNote =
  "Any uncommitted work was set aside on a backup branch and the tree reset to its last commit, so check what is committed first.";

// Sent with --resume on a `resume +N turns` answer, after the step hit its turn cap.
export function moreTurnsPrompt(turns: number, isTreeReset: boolean): string {
  const resetNote = isTreeReset ? ` ${treeResetNote}` : "";
  return `You hit your turn cap; the developer gave you ${turns} more turns.${resetNote} Finish the ticket as before and return the implement record. Nobody is watching this session: never ask a question or wait for an answer.`;
}

// How any resolver judges, shared with the implementer through implementBody.resolving.
export const resolveRules =
  "Give each finding exactly one verdict, Dismiss, Fix, Propose or Halt, by the rules in `docs/agents/verdicts.md`; read it before you judge. Fix by default, and Dismiss, Propose or Halt only where that doc says, with evidence. You may overrule a reviewer's suggested verdict, saying why in `evidence`, except that a suggested Halt resolves only as a Halt or a Propose `decision`. The Fixes land together in one commit, its message naming each finding by number.";

// The resolve prompt's and the /implement-code skill's one description of a record, after "Return `records`, ".
export const resolveRecordFields = `exactly one record per finding: \`finding\` (its number in the list), \`axis\` (the finding's own, or for a finding without one, \`standards\` or \`spec\`), \`where\` (its file:line or area), \`claim\` (what the finding says, in a line), \`verdict\` (\`dismiss\`, \`fix\`, \`propose\` or \`halt\`), \`evidence\` (what you checked and found, and why, when you overruled the suggested verdict), and the fields its verdict needs:

- **Dismiss**: \`reason\`, one of ${codeListOf(dismissReasons)}; for \`covered-later\`, \`coveredBy\`, the later ticket as \`<repo>#<n>\`; for \`kept\`, \`quote\`, the site's reason with its file:line.
- **Fix**: \`quote\`, the quoted code or text, with its file:line, and \`rule\`, the documented rule or spec line it breaks.
- **Propose**: \`reason\`, ${codeListOf(proposeReasons)}, and \`recommendation\`; for \`ticket\`, \`draftIssueTitle\`; for a \`decision\` asking the developer's yes to a new keep, \`draftKeepReason\`, the drafted one-line reason.
- **Halt**: \`recommendation\`, and \`haltScope\`, the later tickets it blocks as \`<repo>#<n>\`, or \`spec\`; omit it to block the whole spec.`;

// The bullets the implement step's prompt and the /implement-code skill share; only their endings differ.
export const implementBody = {
  gitHubWrites:
    "Some tickets need only GitHub writes and no code. Run `gh issue edit` and `gh issue comment` only as the ticket describes them, writing each body to a file under `/tmp` and passing it with `--body-file`. Never close an issue, never change a triage label (such as `ready-for-agent`) on this ticket or another ticket of its spec, and make no other GitHub write.",
  testFirst:
    "Work test-first: if a `tdd` skill is available, call it, at the seams the ticket names or, with none named, seams you pick yourself; never stop to confirm them.",
  checking: "Run typechecking and single test files regularly.",
  oneCommand:
    "Read and search with the Read and Grep tools. Give Bash one command per call, run from the workspace root: no `cd`, no `;` or `&&` chains, no variables.",
  drift:
    "Before review, grep the docs for every name, command or behavior the change renamed, removed or altered, and fix or delete each statement it made untrue.",
  committing:
    "Commit in each repo you changed, on the ticket's branch, then run `npm run check`. When it fails on your change, fix it in a further commit and run it again; never amend.",
  onlyWrites:
    "Those commits and the GitHub writes the ticket describes are your only writes outside the workspace's files: never push, merge, rebase or reset, never close an issue",
  resolving: resolveRules,
  ticketCode:
    "A ticket's code binds its decision. It's your job to fit it to code-style and existing structures, folding it into an existing structure or renaming it where that fits, and to report in the closing comment any departure or any shape that couldn't fit.",
  ticketProse:
    "Ticket prose follows prose-style unless the ticket marks it verbatim.",
  operatorText:
    "Text an operator sees (CLI flags, script names, sheet text) stays as the ticket has it.",
  newDependencies:
    "Add a package only when the ticket's `## New dependencies` section names it. For any other package, record a `spec-ambiguity` blocker naming the package and why it's needed, rather than adding it.",
} as const;

export function ticketBindsSection(): string {
  return sectionOf("What the ticket binds", [
    implementBody.ticketCode,
    implementBody.ticketProse,
    implementBody.operatorText,
    implementBody.newDependencies,
  ]);
}

export function proposedSplitText(slices: ProposedSlice[]): string {
  return slices
    .map(
      ({ delivers, files }, index) =>
        `${index + 1}. ${delivers} (${files.join(", ")})`,
    )
    .join("\n");
}
