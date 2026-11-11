// The push's `keep mine` answers: marks each kept Section as the developer's in the Agent draft, commits it in a
// session workspace of its own and lands it as a session landing. ../DraftPusher.ts calls _keep once the Doc is written;
// the commit is ../runState/draftCommits.ts's and the marks the Workflow's push rules', through ../../Workflow.ts.

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { issueRef } from "../../IssueWorkspaces.ts";
import type { PushRules } from "../../Workflow.ts";
import type { Run } from "../runState.ts";
import { draftCommits } from "../runState/draftCommits.ts";
import { SpecRunBase } from "../SpecRunBase.ts";

// The Agent draft on master and its path, the Doc's text for each Section answered `keep mine`, and the rules that mark them.
export interface KeptDraft {
  draft: string;
  draftPath: string;
  kept: Map<string, string>;
  rules: PushRules;
}

export class DraftKeeper extends SpecRunBase {
  // Lands in a session of its own, closing no issue, since every drafting ticket has landed by the push.
  async _keep(
    run: Run,
    { draft, draftPath, kept, rules }: KeptDraft,
  ): Promise<void> {
    if (kept.size === 0) return;
    const { repo, number } = run.spec.issue;
    const session = `push-${repo}-${number}`;
    const workspace = await this.workspaces.create({ session });
    const clone = this._cloneIn(workspace, repo);
    writeFileSync(join(clone, draftPath), rules.keptOf(draft, kept));
    const named = [...kept.keys()].map((heading) => `"${heading}"`).join(", ");
    await draftCommits.commit(
      { clone, draftPath },
      `Mark ${named} as the developer's in the Agent draft of ${issueRef.labelOf(run.spec.issue)}, for #${number}`,
    );
    await this.wrapUp.runSession(session);
    this._log(
      run,
      `The push kept ${kept.size} Sections as the developer's in the Agent draft.`,
    );
  }
}
