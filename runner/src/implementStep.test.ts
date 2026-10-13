import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";

import {
  type CommittedRecord,
  type Handoff,
  type HandoffRecord,
  implementPrompt,
  type ImplementPromptInput,
  implementRecordProblems,
  implementRecordSchema,
} from "./implementStep.ts";

// The same Ajv setup StepStream validates a step's structured output with.
const validate = new Ajv({ allErrors: true, strict: false }).compile(
  implementRecordSchema,
);

const committed: CommittedRecord = {
  status: "committed",
  branches: [
    {
      repo: "byro-repo",
      branch: "issue-224-implement-step-prompt",
      sha: "9a18184",
    },
  ],
  closing_comment: "Adds the implement-step prompt.",
  boxes_undone: [],
  blockers: [],
};

const handoffFields: Handoff = {
  conclusion: "The schema is done; the prompt is half written.",
  files_to_open: [{ path: "runner/src/implementStep.ts", lines: "1-80" }],
  ruled_out: ["if/then/else in the schema"],
  files_changed: ["runner/src/implementStep.ts"],
  still_failing: ["runner/src/implementStep.test.ts"],
};

const handoff: HandoffRecord = {
  status: "handoff",
  branches: [],
  closing_comment: "",
  boxes_undone: [],
  blockers: [],
  handoff: handoffFields,
};

describe("implementRecordSchema", () => {
  it("accepts a committed record", () => {
    expect(validate(committed)).toBe(true);
  });

  it("accepts a handoff carrying every handoff field", () => {
    expect(validate(handoff)).toBe(true);
  });

  it("accepts a blocked record naming a blocker", () => {
    const blocked = {
      ...committed,
      status: "blocked",
      branches: [],
      blockers: [
        {
          kind: "gated-action",
          detail: "npm run app:build needs a yes",
          recommendation: "Say yes to the build, then retry.",
        },
      ],
    };
    expect(validate(blocked)).toBe(true);
  });

  it("refuses a handoff missing a handoff field", () => {
    const { still_failing: _, ...partial } = handoffFields;
    expect(validate({ ...handoff, handoff: partial })).toBe(false);
  });

  it("refuses a handoff with no handoff fields", () => {
    const { handoff: _, ...bare } = handoff;
    expect(validate(bare)).toBe(false);
  });

  it("refuses handoff fields on a committed record", () => {
    expect(validate({ ...committed, handoff: handoffFields })).toBe(false);
  });

  it("refuses a blocked record with no blocker", () => {
    expect(validate({ ...committed, status: "blocked", branches: [] })).toBe(
      false,
    );
  });

  it("refuses a committed record with no branch", () => {
    expect(validate({ ...committed, branches: [] })).toBe(false);
  });

  it("refuses a blocker of an unknown kind", () => {
    const blocker = { kind: "flaky-test", detail: "x", recommendation: "y" };
    expect(validate({ ...committed, blockers: [blocker] })).toBe(false);
  });
});

describe("implementRecordProblems", () => {
  it("passes a committed record that left a new commit", () => {
    expect(implementRecordProblems(committed, true)).toEqual([]);
  });

  it("refuses a handoff alongside a new commit", () => {
    expect(implementRecordProblems(handoff, true)).toEqual([
      "a handoff must leave its work uncommitted, but the step made a new commit",
    ]);
  });

  it("refuses a committed record with no new commit", () => {
    expect(implementRecordProblems(committed, false)).toEqual([
      "the record says committed, but the step made no new commit",
    ]);
  });
});

describe("implementPrompt", () => {
  const input: ImplementPromptInput = {
    issue: { repo: "byro-repo", number: 224 },
    title: "Implement-step prompt",
    body: "## What to build\n\nThe prompt.",
    branch: "issue-224-implement-step-prompt",
    branchedRepos: ["byro-repo", "sheets-framework"],
    promoteCommand: "npm run issue:promote -- byro-repo 224",
  };
  const noReset = "Don't reset, stash, check out or clean it";

  it("tells a first step nothing about earlier work", () => {
    const prompt = implementPrompt(input);
    expect(prompt).not.toContain("Conclusion:");
    expect(prompt).not.toContain(noReset);
  });

  it("names every repo the workspace put on the issue branch", () => {
    expect(implementPrompt(input)).toContain(
      "These repos are on the ticket's branch, `issue-224-implement-step-prompt`: byro-repo, sheets-framework.",
    );
  });

  it("gives a fresh step the latest handoff", () => {
    const prompt = implementPrompt({ ...input, latestHandoff: handoffFields });
    expect(prompt).toContain(
      "Conclusion: The schema is done; the prompt is half written.\nFiles to open:\n- runner/src/implementStep.ts:1-80",
    );
  });

  it("tells a fresh step to keep the previous step's uncommitted work", () => {
    const prompt = implementPrompt({ ...input, latestHandoff: handoffFields });
    expect(prompt).toContain(noReset);
  });
});
