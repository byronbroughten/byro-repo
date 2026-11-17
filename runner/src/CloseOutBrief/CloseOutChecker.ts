import type { ReadableIssue } from "../IssueReader.ts";
import { issueRef } from "../IssueWorkspaces.ts";
import { closeOutLabels, closeOutWords } from "./closeOutWords.ts";
import { type ReadParent, type Refusals } from "./CloseOutWriter.ts";

// Judges what keeps a read parent from closing out: its open Edit gate, its refusals and what refuses the close itself.
export class CloseOutChecker {
  // Undefined when none is open.
  readonly editGate: ReadableIssue | undefined;
  private readonly read: ReadParent;

  constructor(read: ReadParent) {
    this.read = read;
    this.editGate = editGateOf(read);
  }

  // A sub-issue outside the repo map counts as open, since its state is unread.
  get refusals(): Refusals {
    const { parent, children, undecided } = this.read;
    const openSubIssues = parent.subIssues.filter((ref) => {
      if (
        this.editGate !== undefined &&
        issueRef.isSame(ref, this.editGate.issue)
      ) {
        return false;
      }
      const child = children.find(({ issue }) => issueRef.isSame(issue, ref));
      return child === undefined || child.isOpen;
    });
    return {
      openSubIssues,
      undecided: undecided.items > 0 ? undecided : undefined,
    };
  }

  // Undefined when `--comment-file` may close the parent.
  get closeRefusal(): string | undefined {
    const { parent } = this.read;
    const { nothingWritten, closeProjectOf } = closeOutWords;
    const label = issueRef.labelOf(parent.issue);
    if (!parent.isOpen) return `${label} is already closed; ${nothingWritten}`;
    if (this.editGate === undefined) return undefined;
    const gate = this.editGate.issue;
    return `the Edit gate ${issueRef.labelOf(gate)} is still open: close it out first with ${closeProjectOf(parent.issue)}; ${nothingWritten}`;
  }
}

// Open while every other sub-issue is closed, on a spec with a piece ticket, since `/close-project` runs its steps first.
function editGateOf({
  children,
  parent,
}: ReadParent): ReadableIssue | undefined {
  const hasPieceTicket = children.some(({ labels }) =>
    labels.includes(closeOutLabels.piece),
  );
  const open = children.filter(({ isOpen }) => isOpen);
  const [only] = open;
  if (!hasPieceTicket || open.length !== 1 || only === undefined) {
    return undefined;
  }
  if (children.length < parent.subIssues.length) return undefined;
  return only.labels.includes(closeOutLabels.human) ? only : undefined;
}
