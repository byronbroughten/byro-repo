import { type IssueRef, issueRef } from "../IssueWorkspaces.ts";

const command = "issue:close-parent";

// The phrases `issue:close-parent`'s brief, its checker and its writer share.
export const closeOutWords = {
  command,
  nothingWritten: "nothing was posted or closed",

  // A brief's one line when it has nothing to brief, the script's own failure included.
  noBriefOf(reason: string): string {
    return `${command} brief: none, ${reason}`;
  },

  closePieceOf({ repo, number }: IssueRef): string {
    return `\`/close-piece ${repo} ${number}\``;
  },

  closedOf(parent: IssueRef, path: string): string {
    return `${command} closed ${issueRef.labelOf(parent)} with the comment in ${path}`;
  },
};
