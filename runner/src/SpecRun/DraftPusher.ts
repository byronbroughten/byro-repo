// A piece spec's push, its last spec-end Step: writes each agent Section of the Agent draft on master into the
// Deliverable's Doc through the Docs module, reading the Doc again before each write, and skips one the Doc already
// holds, so a rerun writes nothing twice. It writes nothing while a Section differs from the push baseline
// DraftPuller.ts kept, or is missing, and it stops on a stale revision or pending suggestions; a rerun retries.
// The push rules are the Workflow's, through ../Workflow.ts; ReviewListPoster.ts runs it after the judge Step.

import type { DocRead, Docs } from "../Docs.ts";
import { PendingSuggestions } from "../Docs/PendingSuggestions.ts";
import { StaleRevision } from "../Docs/StaleRevision.ts";
import { git } from "../git.ts";
import { issueRef } from "../IssueWorkspaces.ts";
import { pullOf, pushOf } from "../Workflow.ts";
import type { PullBaseline, Run } from "./runState.ts";
import { SpecRunBase } from "./SpecRunBase.ts";

// An agent Section as the push writes it, beside its Doc text at the last pull.
interface PushedSection {
  heading: string;
  markdown: string;
  pulled: string;
}

// What one push writes: the Doc and its agent Sections.
interface Push {
  docs: Docs;
  documentId: string;
  sections: PushedSection[];
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
      this._cloneUnder(this.config.primaryRoot, run.spec.issue.repo),
      "show",
      `master:${pullOf(workflow).draftPathOf(run.spec.issue)}`,
    );
    const push: Push = {
      docs: rules.docs,
      documentId: baseline.documentId,
      sections: pushedSectionsOf(rules.agentSectionsOf(draft), baseline),
    };
    let written: number;
    try {
      const edited = editedSectionsOf(
        await push.docs.read(push.documentId),
        push,
      );
      if (edited.length > 0) return this._editedStopOf(run, edited);
      written = await writeSections(push);
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
      `The push wrote ${written} of ${push.sections.length} agent Sections into the Deliverable.`,
    );
    return undefined;
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

function pushedSectionsOf(
  agentSections: Map<string, string>,
  baseline: PullBaseline,
): PushedSection[] {
  return [...agentSections].map(([heading, markdown]) => ({
    heading,
    markdown,
    pulled: baseline.sections[heading] ?? emptySection,
  }));
}

function editedSectionsOf(read: DocRead, push: Push): string[] {
  return push.sections.flatMap((section) =>
    isEdited(read, section) ? [section.heading] : [],
  );
}

// Holding the agent text already is no edit: a rerun after a stale revision finds the Sections it wrote that way.
function isEdited(
  read: DocRead,
  { heading, markdown, pulled }: PushedSection,
): boolean {
  const current = read.sections.get(heading);
  if (current === markdown) return false;
  return current !== pulled;
}

// Docs.writeSection forgets its read once it writes, so each write reads, and checks, the Doc again first.
async function writeSections({
  docs,
  documentId,
  sections,
}: Push): Promise<number> {
  let written = 0;
  for (const section of sections) {
    const read = await docs.read(documentId);
    if (read.sections.get(section.heading) === section.markdown) continue;
    if (isEdited(read, section)) {
      throw new StaleRevision(documentId, read.revisionId);
    }
    const { heading, markdown } = section;
    await docs.writeSection({ documentId, heading, markdown });
    written += 1;
  }
  return written;
}
