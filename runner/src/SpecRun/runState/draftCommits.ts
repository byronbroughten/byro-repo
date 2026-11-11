// Commits a piece spec's Agent draft in one clone, for the pull (../DraftPuller.ts) and the push's `keep mine` (../DraftPusher/DraftKeeper.ts).

import { git } from "../../git.ts";

// The spec's clone, and the Agent draft's path from its root.
export interface DraftFile {
  clone: string;
  draftPath: string;
}

export const draftCommits = {
  // A draft that changed nothing commits nothing; true when it committed.
  async commit(
    { clone, draftPath }: DraftFile,
    message: string,
  ): Promise<boolean> {
    await git(clone, "add", "--", draftPath);
    const staged = await git(clone, "diff", "--cached", "--name-only");
    if (staged.trim() === "") return false;
    await git(clone, "commit", "-m", message);
    return true;
  },
};
