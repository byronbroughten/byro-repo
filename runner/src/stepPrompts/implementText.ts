// The bullets the implement step's prompt and the /implement-code skill share, and the implement prompt's workspace section.

import { sectionOf } from "../promptText.ts";
import type { ImplementPromptInput } from "../Workflow.ts";
import { resolveRules } from "./resolveText.ts";

export function committingOf(checkCommand: string): string {
  return `Commit in each repo you changed, on the ticket's branch, then run \`${checkCommand}\`. When it fails on your change, fix it in a further commit and run it again; never amend.`;
}

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
  committing: committingOf("npm run check"),
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

export function implementWorkspaceSection({
  branch,
  branchedRepos,
  promoteCommand,
}: ImplementPromptInput): string {
  return `## Where you work

- Your working directory is the ticket's issue workspace root. These repos are on the ticket's branch, \`${branch}\`: ${branchedRepos.join(", ")}. Every other repo is detached at master.
- To change a detached repo, first put it onto \`${branch}\` with \`${promoteCommand} <repo>\`. Never switch, create or delete a branch yourself.`;
}
