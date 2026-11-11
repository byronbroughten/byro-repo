// The review lists. At landing a ticket with resolve records or a merge-master record gets one review-list comment on the spec and each
// covered-later Dismiss a note on its later ticket, each checked for its marker first.
// SessionReviewer.ts calls _runnersSpecCommentsOf, _postCoveredLaterNotes and _postSessionReviewList,
// which edits a posted list in place where a re-review's differs, the Base skipping a session's push; TicketLander.ts calls _postReviewList at landing;
// SpecEndRunner.ts calls _postReviewList, _hasReviewList, _postReviewListComment and _runnersSpecCommentsOf.
// It builds no collaborator; formats are ../reviewList.ts.

import { isRunnersComment, runnerMark } from "../halts.ts";
import { type IssueRef } from "../IssueWorkspaces.ts";
import {
  coveredLaterNotesOf,
  isDevelopersReviewList,
  reReviewedCommentOf,
  reviewListMarkOf,
  type ReviewListSubject,
  ticketPushOf,
  ticketReviewListOf,
  undecidedCountOf,
} from "../reviewList.ts";
import type { ResolveRecord } from "../stepRecords.ts";
import { type Run, runTickets, type TrackedIssue } from "./runState.ts";
import { ticketSteps } from "./runState/ticketSteps.ts";
import { SpecRunBase } from "./SpecRunBase.ts";

export class ReviewListPoster extends SpecRunBase {
  private get haltRaiser(): HaltRaiser {
    return new HaltRaiser(this.config);
  }

  private get stepLauncher(): StepLauncher {
    return new StepLauncher(this.config);
  }

  private get draftPusher(): DraftPusher {
    return new DraftPusher(this.config);
  }

  // Posts the notes before the comment, so a ticket marked posted has posted both.
  async _postReviewList(run: Run, ticket: TrackedIssue): Promise<void> {
    const state = runTickets.stateOf(run, ticket.issue);
    if (state.isReviewListPosted) return;
    const records = state.resolveRecords ?? [];
    await this._postCoveredLaterNotes(ticket.issue, records);
    const body = ticketReviewListOf({
      ticket: ticket.issue,
      title: ticket.title,
      records,
      mergeMasterRecord: state.mergeMasterRecord,
      unrecordedMerge: state.unrecordedMerge,
      unverified: ticketSteps.keptUnverifiedOf(state),
    });
    if (body !== undefined && !(await this._hasReviewList(run, ticket.issue))) {
      await this._postReviewListComment(run, ticket.issue, body);
    }
    state.isReviewListPosted = true;
    this._saveState(run);
  }

  // A run's landing never edits a posted list, but a session's re-review does, so a Propose it adds reaches the spec.
  async _postSessionReviewList(run: Run, ticket: TrackedIssue): Promise<void> {
    const list = {
      ticket: ticket.issue,
      title: ticket.title,
      records: runTickets.stateOf(run, ticket.issue).resolveRecords ?? [],
    };
    const mark = reviewListMarkOf(ticket.issue);
    const listed = (
      await this.config.github.authoredCommentsOf(run.spec.issue)
    ).filter(
      (comment) => isRunnersComment(comment) && comment.body.includes(mark),
    );
    // Only the developer's is edited, as `runner decide` edits only theirs; anyone else's still counts as posted.
    const posted = listed.find((comment) =>
      isDevelopersReviewList(comment, this.config.developer),
    );
    if (posted !== undefined) {
      const body = reReviewedCommentOf({ ...list, posted: posted.body });
      if (body !== undefined) {
        await this.config.github.editComment(posted.id, body);
      }
      return;
    }
    const body = ticketReviewListOf(list);
    if (body !== undefined && listed.length === 0) {
      await this._postReviewListComment(run, ticket.issue, body);
    }
  }

  // Each checks the later ticket for its mark first, so a rerun never posts it twice.
  async _postCoveredLaterNotes(
    ticket: IssueRef,
    records: ResolveRecord[],
  ): Promise<void> {
    const { github } = this.config;
    for (const note of coveredLaterNotesOf(ticket, records)) {
      const bodies = await github.commentsOf(note.issue);
      if (bodies.some((body) => body.includes(note.mark))) continue;
      await github.comment(note.issue, `${runnerMark}\n${note.body}`);
    }
  }

  // The marker, not run state, is the record: a run killed after posting but before saving finds it.
  async _hasReviewList(run: Run, subject: ReviewListSubject): Promise<boolean> {
    const mark = reviewListMarkOf(subject);
    const comments = await this._runnersSpecCommentsOf(run);
    return comments.some((body) => body.includes(mark));
  }

  async _runnersSpecCommentsOf(run: Run): Promise<string[]> {
    const comments = await this.config.github.authoredCommentsOf(
      run.spec.issue,
    );
    return comments.filter(isRunnersComment).map(({ body }) => body);
  }

  async _postReviewListComment(
    run: Run,
    subject: ReviewListSubject,
    body: string,
  ): Promise<void> {
    await this._comment(run, body);
    const { items } = undecidedCountOf([body]);
    if (this.config.knobs.reviewListCadence === "per-ticket" && items > 0) {
      await this._announce(run, ticketPushOf(subject, items));
    }
  }
}
