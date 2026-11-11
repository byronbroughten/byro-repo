// Applies the Outline edits each answered Research Halt approves to the spec body, word for word, once its answer is read,
// so the body stays the developer's Trusted text; an edit it can't apply raises a fresh Research Halt rather than throwing.
// TicketSelector.ts calls it each pick, after reading answers; the edits themselves are ../outlineEdits.ts and the Halt's words ../halts.ts.

import { type Halt, haltNameOf, unappliedEditsHaltOf } from "../halts.ts";
import { outlineEdits } from "../outlineEdits.ts";
import type { OutlineEdit } from "../stepRecords.ts";
import { HaltRaiser } from "./HaltRaiser.ts";
import type { Run } from "./runState.ts";
import { runHalts } from "./runState/runHalts.ts";
import { SpecRunBase } from "./SpecRunBase.ts";

export class OutlineEditApplier extends SpecRunBase {
  private get haltRaiser(): HaltRaiser {
    return new HaltRaiser(this.config);
  }

  // An applied edit counts as applied when a killed run reads the answer again, so the Halt is marked delivered only after.
  async _applyAnswered(run: Run): Promise<void> {
    const answered = runHalts
      .of(run)
      .filter(
        ({ kind, answer, isDelivered }) =>
          kind === "research" && answer !== undefined && !isDelivered,
      );
    if (answered.length === 0) return;
    for (const halt of answered) {
      const approved = approvedOf(halt);
      if (approved.length > 0) await this._apply(run, halt, approved);
      halt.isDelivered = true;
      this._saveState(run);
    }
    await this.haltRaiser._postUnpostedHalts(run);
  }

  private async _apply(
    run: Run,
    halt: Halt,
    approved: OutlineEdit[],
  ): Promise<void> {
    const specIssue = run.spec.issue;
    const { body } = await this.config.github.issueOf(specIssue);
    const applied = outlineEdits.applyTo(body, approved);
    if (applied.body !== body) {
      await this.config.github.editBody(specIssue, applied.body);
      this._log(
        run,
        `Applied the Outline edits ${haltNameOf(halt)} approves to the spec body.`,
      );
    }
    if (applied.unapplied.length === 0) return;
    runHalts.raise(run, {
      ticket: halt.ticket,
      drafts: [unappliedEditsHaltOf(halt, applied.unapplied)],
    });
  }
}

// A `stop spec` answer approves nothing, whatever else it names.
function approvedOf(halt: Halt): OutlineEdit[] {
  if (runHalts.isStopSpec(halt)) return [];
  return outlineEdits.approvedOf(
    halt.answer?.text ?? "",
    halt.outlineEdits ?? [],
  );
}
