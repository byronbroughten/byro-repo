// The prompt text the implement and resolve steps share with the core and with the /implement-code skill: the resumes'
// prompts, the shared body of the implement prompt, the resolve rules and record fields, and the generated
// /implement-* skills' shared ending. Each step's own prompt stays in its file.

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

export interface InteractiveSkillInput {
  // The skill's text before its ending: frontmatter, opening and the Workflow's own sections.
  body: string;
  checkCommand: string;
  // Each command is written with `<repo>` and `<n>` placeholders.
  reviewCommand: string;
  // Takes the records file's path last.
  resolveCommand: string;
  // Written with `<spec>` and the item id in place of `<n>`; takes the decision's text last.
  decideCommand: string;
  wrapUpCommand: string;
}

// The ending every generated /implement-* skill shares: review, resolve, report, wait and land.
export function interactiveSkillOf({
  body,
  checkCommand,
  reviewCommand,
  resolveCommand,
  decideCommand,
  wrapUpCommand,
}: InteractiveSkillInput): string {
  return `${body}

## When you're done

- ${implementBody.drift}
- ${implementBody.committing} When it fails only on something your change didn't cause, carry on and name the failure in your report.
- ${implementBody.onlyWrites}. The review and wrap-up commands in the ending make every other write.
- Run git commands one at a time: inside an entered worktree, Claude Code refuses a compound git command.
- Then, in order:
  1. **Review**: run \`${reviewCommand}\`, resolving \`<repo>\` to \`<owner>/<repo>\` here and in resolve. It runs the runner's review session on this ticket and records it. While this session's context is under the ticket budget, it prints the findings, numbered, each with its axis and suggested verdict, for you to resolve; past it, a fresh resolver resolves them instead and it goes straight to the review list.
  2. **Resolve**, when it printed findings: ${implementBody.resolving} Then run \`${checkCommand}\`. Write \`.runner/resolve-<n>.json\`, gitignored, as \`{ "records": [...] }\`, ${indentedOf(resolveRecordFields)}

     Then run \`${resolveCommand} .runner/resolve-<n>.json\`. It checks the records and your commits by the run's rules; when it refuses them, correct what it names and run it again.
  3. Either way, review or resolve prints the review list, by axis then verdict with each suggested verdict overruled, posts it on the spec or, on a second review, adds its new items to the list posted there, and writes the review facts. It prints each Halt as \`S<n>.<k>\`; answer it with the developer in the session. When it exits short of reviewed, report why and stop.
  4. **Report**: post in the session what review caught and what was fixed, then each Propose on its own line, the item then \`→\` and its record's \`recommendation\`.
  5. **Wait for the developer's go-ahead.** Land nothing before it. When the developer has this session implement a Propose before landing, commit it, then record the item with \`${decideCommand} 'fixed in session · <commit>'\`, never \`--handled\`: that leaves it undecided, and wrap-up then leaves a Standalone ticket open.
  6. Call \`ExitWorktree\` with \`keep\`, so wrap-up can remove the workspace.
  7. **Land**: \`${wrapUpCommand} --closing "<what landed>" [--undone "<box>: <reason>"]...\`, one \`--undone\` per acceptance box left undone. A note holding \`$(\` or a backtick goes in a file in temp, passed with \`--closing-file <path>\` in place of \`--closing\`, the path written out with no \`$\`. A ticket with no branch ahead of master, one that needed only GitHub or Doc writes, adds \`--no-code\`: \`${wrapUpCommand} --no-code --closing "<what landed>"\`. A ticket that changes wrap-up or the facts file's format lands through its workspace's own script instead, by \`docs/agents/git-workflow.md\`.
`;
}

// Under a numbered step's text, so a list inside it stays in the step.
function indentedOf(text: string): string {
  return text.replaceAll(/\n(?=.)/g, "\n     ");
}

export function proposedSplitText(slices: ProposedSlice[]): string {
  return slices
    .map(
      ({ delivers, files }, index) =>
        `${index + 1}. ${delivers} (${files.join(", ")})`,
    )
    .join("\n");
}
