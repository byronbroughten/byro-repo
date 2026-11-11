// A piece spec's push, its last spec-end Step: writes each agent Section of the Agent draft on master into the
// Deliverable's Doc through the Docs module, reading the Doc again before each write, and skips one the Doc already
// holds, so a rerun writes nothing twice. A Section that differs from the push baseline DraftPuller.ts kept, or is
// missing, raises a push Halt on the spec issue first, and the push writes nothing until every one is answered:
// `overwrite` writes the agent text, `keep mine` marks the Section as the developer's, through DraftPusher/DraftKeeper.ts.
// It stops on a stale revision or pending suggestions; a rerun retries. The push rules are the Workflow's, through
// ../Workflow.ts; ReviewListPoster.ts runs it after the judge Step.

import type { DocRead, Docs } from "../Docs.ts";
import { PendingSuggestions } from "../Docs/PendingSuggestions.ts";
import { StaleRevision } from "../Docs/StaleRevision.ts";
import { git } from "../git.ts";
import { type Halt, type HaltDraft, isAnswered, pushHaltOf } from "../halts.ts";
import { haltReplies, type PushAnswer } from "../halts/haltReplies.ts";
import { issueRef } from "../IssueWorkspaces.ts";
import { TicketHalted } from "../TicketHalted.ts";
import { pullOf, pushOf } from "../Workflow.ts";
import { DraftKeeper } from "./DraftPusher/DraftKeeper.ts";
import { HaltRaiser } from "./HaltRaiser.ts";
import type { PullBaseline, Run } from "./runState.ts";
import { runHalts } from "./runState/runHalts.ts";
import { SpecRunBase } from "./SpecRunBase.ts";

// An agent Section as the push writes it, beside its Doc text at the last pull; undefined with no pull recorded.
interface PushedSection {
  heading: string;
  markdown: string;
  pulled: string | undefined;
}

// What one push writes: the Doc and its agent Sections.
interface Push {
  docs: Docs;
  documentId: string;
  sections: PushedSection[];
}

// Where each agent Section stands on a push: written, kept as the Doc has it, or held on a push Halt.
interface PushPlan {
  written: PushedSection[];
  // The Doc's text by heading, for each Section answered `keep mine`.
  kept: Map<string, string>;
  drafts: HaltDraft[];
  isHeld: boolean;
}

// A Section's latest push Halt: open, answered with an option, or answered with neither, which asks again.
type HaltState = PushAnswer | "open" | "unrecognised";

// A Section the pull never saw counts as empty, so adding its heading to the Doc lets the push write it.
const emptySection = "\n";

export class DraftPusher extends SpecRunBase {
  private get haltRaiser(): HaltRaiser {
    return new HaltRaiser(this.config);
  }

  private get draftKeeper(): DraftKeeper {
    return new DraftKeeper(this.config);
  }

  // The message the run stops on; undefined once the Doc holds every agent Section. Throws TicketHalted on a push Halt.
  async _push(run: Run): Promise<string | undefined> {
    if (run.state.isPushed === true) return undefined;
    const workflow = this._workflowOf(run.spec);
    const baseline = pushBaselineOf(run);
    const documentId =
      baseline?.documentId ?? pullOf(workflow).deliverableOf(run.spec);
    if (documentId === undefined) {
      this._log(run, "The push found no Deliverable Doc to push into.");
      return undefined;
    }
    const rules = pushOf(workflow);
    const clone = this._cloneUnder(
      this.config.primaryRoot,
      run.spec.issue.repo,
    );
    const draftPath = pullOf(workflow).draftPathOf(run.spec.issue);
    const listed = await git(
      clone,
      "ls-tree",
      "--name-only",
      "master",
      "--",
      draftPath,
    );
    if (listed.trim() === "") {
      this._log(run, "The push found no Agent draft on master to push.");
      return undefined;
    }
    const draft = await git(clone, "show", `master:${draftPath}`);
    const sections = pushedSectionsOf(rules.agentSectionsOf(draft), baseline);
    let written: number;
    try {
      const plan = planOf(
        await rules.docs.read(documentId),
        sections,
        pushAnswersOf(run),
      );
      await this._halt(run, plan);
      written = await writeSections({
        docs: rules.docs,
        documentId,
        sections: plan.written,
      });
      await this.draftKeeper._keep(run, {
        draft,
        draftPath,
        kept: plan.kept,
        rules,
      });
    } catch (error) {
      if (!(
        error instanceof StaleRevision || error instanceof PendingSuggestions
      )) {
        throw error;
      }
      return `The push stopped: ${error.message} Rerun to retry it: \`${this._rerunCommandOf(run)}\`.`;
    }
    for (const halt of pushHaltsOf(run)) halt.isDelivered = true;
    run.state.isPushed = true;
    this._saveState(run);
    this._log(
      run,
      `The push wrote ${written} of ${sections.length} agent Sections into the Deliverable.`,
    );
    return undefined;
  }

  // Raised on the spec issue, since the push belongs to no ticket; an open one holds the push without raising it again.
  private async _halt(run: Run, { drafts, isHeld }: PushPlan): Promise<void> {
    if (drafts.length === 0 && !isHeld) return;
    if (drafts.length > 0) {
      runHalts.raise(run, { ticket: run.spec.issue, drafts });
      this._saveState(run);
      await this.haltRaiser._postUnpostedHalts(run);
    }
    throw new TicketHalted(issueRef.labelOf(run.spec.issue));
  }
}

// The newest any ticket recorded, since each drafting ticket pulls the Doc again after the one before it landed.
function pushBaselineOf(run: Run): PullBaseline | undefined {
  return run.tickets
    .map((ticket) => run.state.tickets[issueRef.labelOf(ticket)]?.pullBaseline)
    .filter((baseline) => baseline !== undefined)
    .at(-1);
}

function pushedSectionsOf(
  agentSections: Map<string, string>,
  baseline: PullBaseline | undefined,
): PushedSection[] {
  return [...agentSections].map(([heading, markdown]) => ({
    heading,
    markdown,
    pulled:
      baseline === undefined
        ? undefined
        : (baseline.sections[heading] ?? emptySection),
  }));
}

function pushHaltsOf(run: Run): Halt[] {
  return runHalts.of(run).filter(({ kind }) => kind === "push");
}

// Each Section's latest undelivered push Halt: open, or the answer it gave; an answer that is neither option asks again.
function pushAnswersOf(run: Run): Map<string, HaltState> {
  return pushHaltsOf(run)
    .filter(({ isDelivered }) => !isDelivered)
    .reduce((answers, halt) => {
      if (halt.pushSection === undefined) return answers;
      let answer: HaltState = "open";
      if (isAnswered(halt)) {
        answer = haltReplies.pushAnswerOf(halt) ?? "unrecognised";
      }
      answers.set(halt.pushSection, answer);
      return answers;
    }, new Map<string, HaltState>());
}

// Gathers every Halt before anything is written, so the push writes the Doc as one act.
function planOf(
  read: DocRead,
  sections: PushedSection[],
  answers: Map<string, HaltState>,
): PushPlan {
  const plan: PushPlan = {
    written: [],
    kept: new Map(),
    drafts: [],
    isHeld: false,
  };
  for (const section of sections) {
    const { heading, markdown } = section;
    const current = read.sections.get(heading);
    const answer = answers.get(heading);
    if (current === markdown) continue;
    if (answer === "keep-mine") {
      plan.kept.set(heading, current ?? "");
      continue;
    }
    if (answer === "open") {
      plan.isHeld = true;
      continue;
    }
    if (current === undefined) {
      plan.drafts.push(pushHaltOf(heading, "missing"));
      continue;
    }
    if (answer === "overwrite") {
      plan.written.push({ ...section, pulled: current });
      continue;
    }
    if (isEdited(read, section)) {
      plan.drafts.push(pushHaltOf(heading, "changed"));
      continue;
    }
    plan.written.push(section);
  }
  return plan;
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

// Holding the agent text already is no edit: a rerun after a stale revision finds the Sections it wrote that way.
function isEdited(
  read: DocRead,
  { heading, markdown, pulled }: PushedSection,
): boolean {
  const current = read.sections.get(heading);
  if (current === markdown) return false;
  return current !== pulled;
}
