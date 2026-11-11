// A piece spec's push, its last spec-end Step: writes each agent Section of the Agent draft on master into the
// Deliverable's Doc through the Docs module, reading the Doc again before each write, and skips one the Doc already
// holds, so a rerun writes nothing twice. It writes nothing while a Section differs from the push baseline
// DraftPuller.ts kept, or is missing, and it stops on a stale revision or pending suggestions; a rerun retries.
// The push rules are the Workflow's, through ../Workflow.ts; ReviewListPoster.ts runs it after the judge Step.

import { join } from "node:path";

import type { DocRead, Docs } from "../Docs.ts";
import { PendingSuggestions } from "../Docs/PendingSuggestions.ts";
import { StaleRevision } from "../Docs/StaleRevision.ts";
import { git } from "../git.ts";
import { issueRef } from "../IssueWorkspaces.ts";
import { pullOf, pushOf } from "../Workflow.ts";
import type { PullBaseline, Run } from "./runState.ts";
import { SpecRunBase } from "./SpecRunBase.ts";

// What one push writes: the Doc, its Sections as the pull saw them, and the agent Sections by heading.
interface Push {
  docs: Docs;
  baseline: PullBaseline;
  agentSections: Map<string, string>;
}

// A Section the pull never saw counts as empty, so adding its heading to the Doc lets the push write it.
const emptySection = "\n";

export class DraftPusher extends SpecRunBase {
  // The message the run stops on; undefined once the Doc holds every agent Section.
  async _push(run: Run): Promise<string | undefined> {
    if (run.state.isPushed === true) return undefined;
    const baseline = pushBaselineOf(run);
    if (baseline === undefined) {
      this._log(run, "The push found no pulled drafting ticket to push.");
      return undefined;
    }
    const workflow = this._workflowOf(run.spec);
    const rules = pushOf(workflow);
    const draft = await git(
      this._primaryCloneOf(run.spec.issue.repo),
      "show",
      `master:${pullOf(workflow).draftPathOf(run.spec.issue)}`,
    );
    const push: Push = {
      docs: rules.docsOf(),
      baseline,
      agentSections: rules.agentSectionsOf(draft),
    };
    let written: number;
    try {
      const edited = editedSectionsOf(
        await push.docs.read(baseline.documentId),
        push,
      );
      if (edited.length > 0) return this._editedStopOf(run, edited);
      written = await writtenCountOf(push);
    } catch (error) {
      if (!(
        error instanceof StaleRevision || error instanceof PendingSuggestions
      )) {
        throw error;
      }
      return `The push stopped: ${error.message} Rerun to retry it: \`${this._rerunCommandOf(run)}\`.`;
    }
    run.state.isPushed = true;
    this._saveState(run);
    this._log(
      run,
      `The push wrote ${written} of ${push.agentSections.size} agent Sections into the Deliverable.`,
    );
    return undefined;
  }

  private _primaryCloneOf(repo: string): string {
    const clonePath = this.config.knobs.clonePaths[repo];
    if (clonePath === undefined) {
      throw new Error(`The repo map has no clone of ${repo}.`);
    }
    return join(this.config.primaryRoot, clonePath);
  }

  private _editedStopOf(run: Run, edited: string[]): string {
    const named = edited.map((heading) => `"${heading}"`).join(", ");
    return `The push wrote nothing to the Deliverable of ${issueRef.labelOf(run.spec.issue)}, since it never writes over your edits: ${named} changed since the pull or has no heading in the Doc. Put back each one's pulled text, its heading or the Agent draft's text, then rerun: \`${this._rerunCommandOf(run)}\`.`;
  }
}

// The last pull's, since each drafting ticket pulls the Doc again after the one before it landed.
function pushBaselineOf(run: Run): PullBaseline | undefined {
  return run.tickets
    .map((ticket) => run.state.tickets[issueRef.labelOf(ticket)]?.pullBaseline)
    .filter((baseline) => baseline !== undefined)
    .at(-1);
}

function editedSectionsOf(read: DocRead, push: Push): string[] {
  return [...push.agentSections].flatMap(([heading, markdown]) =>
    isEdited(read, push, heading, markdown) ? [heading] : [],
  );
}

// Holding the agent text already is no edit: a rerun after a stale revision finds the Sections it wrote that way.
function isEdited(
  read: DocRead,
  { baseline }: Push,
  heading: string,
  markdown: string,
): boolean {
  const current = read.sections.get(heading);
  if (current === markdown) return false;
  return current !== (baseline.sections[heading] ?? emptySection);
}

// Docs.writeSection forgets its read once it writes, so each Section is read again, and checked again, before its write;
// an edit since the first read is a Doc changed under the push, which the rerun's first read then names.
async function writtenCountOf(push: Push): Promise<number> {
  const { docs, baseline, agentSections } = push;
  const { documentId } = baseline;
  let written = 0;
  for (const [heading, markdown] of agentSections) {
    const read = await docs.read(documentId);
    if (read.sections.get(heading) === markdown) continue;
    if (isEdited(read, push, heading, markdown)) {
      throw new StaleRevision(documentId, read.revisionId);
    }
    await docs.writeSection({ documentId, heading, markdown });
    written += 1;
  }
  return written;
}
