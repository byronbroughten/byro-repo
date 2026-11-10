// The step results, records and scripted steps SpecRun tests give a FakeAgentStep, re-exported by ../specRunHarness.ts.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { StepRequest, StepResult } from "../AgentStep.ts";
import { git } from "../GitFixture.ts";
import type { Blocker, Handoff, ImplementRecord } from "../implementStep.ts";
import type { ResolveRecord } from "../resolveStep.ts";
import type { ReviewFinding } from "../reviewStep.ts";

export type StepScript = (request: StepRequest) => Promise<StepResult>;

export const stepResults = {
  resultOf(record: unknown): StepResult {
    return {
      output: { status: "valid", record },
      sessionId: "session",
      account: 1,
      peakContext: undefined,
      hasCrossedCeiling: false,
      hang: undefined,
      exitSubtype: "success",
      errorText: undefined,
      hasNoConversation: false,
      usage: undefined,
      limitHit: undefined,
      deniedTools: [],
    };
  },

  // An implement step's structured output carries its record under `record`.
  implementResultOf(record: ImplementRecord): StepResult {
    return stepResults.resultOf({ record });
  },

  // A handoff record commits nothing, so it names no branch.
  handoffResultOf(handoff: Handoff): StepResult {
    return stepResults.implementResultOf({
      status: "handoff",
      branches: [],
      closingComment: "",
      boxesUndone: [],
      blockers: [],
      handoff,
    });
  },

  recordOf(
    branch: string,
    sha: string,
    change: Partial<ImplementRecord> = {},
  ): ImplementRecord {
    return {
      status: "committed",
      branches: [{ repo: "byro-repo", branch, sha }],
      closingComment: "Landed it.",
      boxesUndone: [],
      blockers: [],
      ...change,
    } as ImplementRecord;
  },

  get crashed(): StepResult {
    return {
      ...stepResults.resultOf(undefined),
      output: { status: "none" },
      sessionId: "crashed-session",
      exitSubtype: "error_during_execution",
    };
  },

  // A resume whose session's transcript is gone.
  get noConversation(): StepResult {
    return {
      ...stepResults.resultOf(undefined),
      output: { status: "none" },
      sessionId: "lost-session",
      exitSubtype: "error_during_execution",
      hasNoConversation: true,
    };
  },

  get capped(): StepResult {
    return {
      ...stepResults.resultOf(undefined),
      output: { status: "none" },
      sessionId: "capped-session",
      exitSubtype: "error_max_turns",
    };
  },

  // The adapter itself throws, so the step never starts.
  throws(message: string): StepScript {
    return async () => {
      throw new Error(message);
    };
  },

  // Commits `file` on the ticket's branch in the workspace, as a real implement step would.
  implemented(
    file: string,
    { content = "export {};\n", act = () => {} } = {},
  ): StepScript {
    return async (request: StepRequest) => {
      act();
      mkdirSync(dirname(join(request.cwd, file)), { recursive: true });
      writeFileSync(join(request.cwd, file), content);
      git(request.cwd, "add", file);
      git(request.cwd, "commit", "-m", `Add ${file}`);
      const branch = git(request.cwd, "branch", "--show-current");
      return stepResults.implementResultOf(
        stepResults.recordOf(branch, git(request.cwd, "rev-parse", "HEAD")),
      );
    };
  },

  // Commits nothing and returns a blocked record, as an implementer stuck before its first commit would.
  blocked(blockers: Blocker[], facts: Partial<StepResult> = {}): StepScript {
    return async (request: StepRequest) => ({
      ...stepResults.implementResultOf(
        stepResults.recordOf(git(request.cwd, "branch", "--show-current"), "", {
          status: "blocked",
          blockers,
        }),
      ),
      sessionId: "implement-session",
      peakContext: 90_000,
      ...facts,
    });
  },

  // Makes only GitHub writes and commits nothing, as an implement step on a ticket with no code would.
  get applied(): StepResult {
    return stepResults.implementResultOf({
      status: "applied",
      branches: [],
      githubWrites: [
        {
          issue: "byronbroughten/byro-repo#213",
          action: "comment",
          url: "https://github.com/byronbroughten/byro-repo/issues/213#issuecomment-1",
          summary: "Posted the addendum.",
        },
      ],
      closingComment: "Posted the addendum.",
      boxesUndone: [],
      blockers: [],
    });
  },

  // Removes the committed RED file, as a red-checks step that turns the checks green would.
  get greened(): StepScript {
    return async (request) => {
      git(request.cwd, "rm", "-q", "RED");
      git(request.cwd, "commit", "-m", "Remove RED");
      return stepResults.resultOf({ summary: "Removed RED." });
    };
  },

  reviewed(findings: ReviewFinding[] = []): StepResult {
    return stepResults.resultOf({ findings });
  },

  // Finding `line` of one.ts, as a reviewer on `axis` reports it.
  findingOf(
    line: number,
    axis: ReviewFinding["axis"] = "standards",
    suggestedVerdict: ReviewFinding["suggestedVerdict"] = "fix",
  ): ReviewFinding {
    return {
      axis,
      where: `one.ts:${line}`,
      claim: `Line ${line} is wrong.`,
      suggestedVerdict,
      reason: "It breaks a rule.",
    };
  },

  // Commits `fixFile`, as a resolver landing its Fix verdicts would, and returns the records.
  resolved(records: ResolveRecord[], fixFile?: string): StepScript {
    return async (request) => {
      if (fixFile !== undefined) {
        writeFileSync(join(request.cwd, fixFile), "export {};\n");
        git(request.cwd, "add", fixFile);
        git(request.cwd, "commit", "-m", `Fix ${fixFile}`);
      }
      return stepResults.resultOf({ records });
    };
  },
};
