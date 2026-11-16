// The implementer sessions a review or resolve step resumed, and each side's cost of them: the turns before the resume are
// the implementer's, the resumed turns and their subagents the review's. transcriptFacts.ts builds one per ticket.

import {
  costUsdOf,
  type SessionEntries,
  stepIdsOf,
  type TicketSessions,
  timeOf,
  type Transcript,
  type TranscriptEntry,
} from "../transcriptFacts.ts";

type CostSide = "implementer" | "review";

interface StartResume {
  startedAt: number;
}

interface PromptResume {
  promptIndex: number;
}

type ReviewResume = StartResume | PromptResume;

interface ReviewCut {
  index: number;
  time: number;
}

const taskNotificationKind = "task-notification";

export class ReviewResumes {
  private readonly resumes: Map<string, ReviewResume>;

  constructor(sessions: TicketSessions) {
    this.resumes = resumesOf(sessions);
  }

  static init(sessions: TicketSessions): ReviewResumes {
    return new ReviewResumes(sessions);
  }

  costUsdOf(transcripts: Transcript[], side: CostSide): number | undefined {
    return costUsdOf(
      transcripts.map((transcript) => {
        const resume = this.resumes.get(transcript.sessionId);
        return resume === undefined
          ? transcript
          : resumeSplitOf(transcript, resume)[side];
      }),
    );
  }
}

// With no recorded start, a post-review `implement` resume before resolve is a budget handoff, so it stays in cost.
function resumesOf(sessions: TicketSessions): Map<string, ReviewResume> {
  const implementerIds = new Set(stepIdsOf(sessions, "implement"));
  const firstReview = sessions.steps.find(({ agent }) => agent === "review");
  const launchCounts = new Map<string, number>();
  const resumes = new Map<string, ReviewResume>();
  let hasReviewRun = false;
  for (const { agent, sessionId } of sessions.steps) {
    const promptIndex = launchCounts.get(sessionId) ?? 0;
    launchCounts.set(sessionId, promptIndex + 1);
    if (agent === "review") hasReviewRun = true;
    if (
      (agent === "review" || agent === "resolve") &&
      hasReviewRun &&
      implementerIds.has(sessionId) &&
      !resumes.has(sessionId)
    ) {
      resumes.set(
        sessionId,
        firstReview?.startedAt === undefined
          ? { promptIndex }
          : { startedAt: Date.parse(firstReview.startedAt) },
      );
    }
  }
  return resumes;
}

// A subagent goes to the side its first timed entry falls on.
function resumeSplitOf(
  { entries, subagents }: Transcript,
  resume: ReviewResume,
): Record<CostSide, SessionEntries> {
  const cut =
    "startedAt" in resume
      ? startCutOf(entries, resume)
      : promptCutOf(entries, resume);
  if (cut === undefined) {
    return {
      implementer: { entries, subagents },
      review: { entries: [], subagents: [] },
    };
  }
  const split: Record<CostSide, SessionEntries> = {
    implementer: { entries: entries.slice(0, cut.index), subagents: [] },
    review: { entries: entries.slice(cut.index), subagents: [] },
  };
  for (const subagent of subagents) {
    const side = startOf(subagent) < cut.time ? "implementer" : "review";
    split[side].subagents.push(subagent);
  }
  return split;
}

function startCutOf(
  entries: TranscriptEntry[],
  { startedAt }: StartResume,
): ReviewCut {
  const index = entries.findIndex(
    (entry) => (timeOf(entry) ?? -Infinity) >= startedAt,
  );
  return { index: index === -1 ? entries.length : index, time: startedAt };
}

// Undefined when the transcript lacks the resumed launch's prompt.
function promptCutOf(
  entries: TranscriptEntry[],
  { promptIndex }: PromptResume,
): ReviewCut | undefined {
  const prompt = entries.filter(isPrompt)[promptIndex];
  if (prompt === undefined) return undefined;
  return { index: entries.indexOf(prompt), time: timeOf(prompt) ?? Infinity };
}

// A subagent with no timed entry starts before any resume.
function startOf(entries: TranscriptEntry[]): number {
  return entries.map(timeOf).find((time) => time !== undefined) ?? -Infinity;
}

// Each launch writes one: a main-loop user entry that is neither a tool's result nor one Claude Code adds itself.
function isPrompt({
  type,
  isSidechain,
  isMeta,
  isCompactSummary,
  origin,
  message,
}: TranscriptEntry): boolean {
  if (type !== "user" || isSidechain === true) return false;
  if (isMeta === true || isCompactSummary === true) return false;
  if (origin?.kind === taskNotificationKind) return false;
  const content = message?.content;
  if (typeof content === "string") return true;
  return Array.isArray(content) && !content.some(isToolResult);
}

function isToolResult(block: unknown): boolean {
  return (
    typeof block === "object" &&
    block !== null &&
    "type" in block &&
    block.type === "tool_result"
  );
}
