// Where a spec's run state file and progress log sit in the state folder.
// The RunState saved there is ../runState.ts; SpecRunBase.ts reads and writes it.

import { join } from "node:path";

import { fileStemOf, type IssueRef } from "../../IssueWorkspaces.ts";

export const statePaths = {
  runStatePathOf(stateFolder: string, spec: IssueRef): string {
    return join(stateFolder, `${fileStemOf(spec)}.run.json`);
  },

  progressLogPathOf(stateFolder: string, spec: IssueRef): string {
    return join(stateFolder, `${fileStemOf(spec)}.log`);
  },
};
