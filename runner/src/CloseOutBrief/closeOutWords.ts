import { type IssueRef, issueRef } from "../IssueWorkspaces.ts";
import { labels } from "../WrapUp/wrapUpTypes.ts";

const command = "issue:close-parent";

// `/close-project` and `judge-brief` find a piece ticket by this label, never by a missing `code` one, since a mixed spec has both.
export const closeOutLabels = { ...labels, piece: "piece" } as const;

// The phrases `issue:close-parent`'s brief, its checker and its writer share, and the piece-ticket line `runner judge-brief` shares.
export const closeOutWords = {
  command,
  nothingWritten: "nothing was posted or closed",

  // A brief's one line when it has nothing to brief, the script's own failure included.
  noBriefOf(reason: string): string {
    return `${command} brief: none, ${reason}`;
  },

  // Always the parent's number, an Edit gate's spec included.
  closeProjectOf({ repo, number }: IssueRef): string {
    return `\`/close-project ${repo} ${number}\``;
  },

  closedOf(parent: IssueRef, path: string): string {
    return `${command} closed ${issueRef.labelOf(parent)} with the comment in ${path}`;
  },

  // Each of `pieceRefs` labels a sub-issue carrying the `piece` label.
  pieceTicketOf(pieceRefs: string[]): string {
    if (pieceRefs.length === 0) {
      return `none, no sub-issue carries the \`${closeOutLabels.piece}\` label`;
    }
    const verb = pieceRefs.length === 1 ? "carries" : "carry";
    return `${pieceRefs.join(", ")} ${verb} the \`${closeOutLabels.piece}\` label`;
  },
};
