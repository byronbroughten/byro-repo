import { describe, expect, it } from "vitest";

import {
  endingCommands,
  expectInOrder,
  parentCloseOutSteps,
} from "../../stepPrompts/interactiveSkillFixture.ts";
import { implementPieceSkillOf } from "./implementPieceSkill.ts";
import { pieceImplementPrompt } from "./implementStep.ts";

const skill = implementPieceSkillOf({
  ...endingCommands,
  overlapCommand: ["npm", "run", "overlap", "--"],
  piecePullCommand: "npm run piece:pull -- <repo> <n>",
});

const stepPrompt = pieceImplementPrompt({
  issue: { repo: "personal", number: 12 },
  spec: { repo: "personal", number: 10 },
  title: "Draft the opening",
  body: "ticket body",
  labels: [],
  branch: "issue-12-draft",
  branchedRepos: ["personal"],
  workspacePath: "/workspace",
  promoteCommand: "npm run issue:promote -- personal 12",
  draftPath: "writing/agent-drafts/10.md",
});

describe("implementPieceSkillOf", () => {
  it("is the user-invoked implement-piece skill", () => {
    expect(skill).toMatch(
      /^---\nname: implement-piece\ndescription: ".+"\nargument-hint: "<repo> <n>"\ndisable-model-invocation: true\n---\n/,
    );
  });

  it("sends a Research issue to /research-piece and stops on a ready-for-human ticket", () => {
    expect(skill).toContain(".claude/skills/research-piece/SKILL.md");
    expect(skill).toContain(
      "A `ready-for-human` ticket: state its title, name the skill or steps its body says to run, and stop.",
    );
  });

  it("drafts by the implement step's own lines", () => {
    const shared = [
      "Its file format is in `docs/pieces/agent-draft.md`.",
      'Draft by the rules under "Implementing a piece spec" in `docs/pieces/rules.md`, writing to the Agent draft and never the Deliverable\'s Doc.',
      "with its mark on the line under the heading: `<!-- agent -->`, or `<!-- agent <headingId> -->` where the draft's mark holds an ID. Copy a mark unchanged, its ID included. Change no other Section, never one marked `<!-- developer -->`, and no other file.",
      "A Section never needs a renamed or invented heading",
      "Read `docs/writing-voice.md` and `docs/writing-craft.md` in full before your first prose edit.",
      "Read the spec's Supporting Material only through the Drive read tools you were given, by the file IDs the spec lists.",
      "Review, resolve and any fresh step after a handoff read the same files",
      "- Send the reads and greps you've already decided on together in one turn, and don't add a call to fill a batch.",
    ];
    shared.forEach((line) => {
      expect(skill).toContain(line);
      expect(stepPrompt).toContain(line);
    });
  });

  it("ends with its own drift and only-writes lines, not the code skill's", () => {
    expect(skill).toContain(
      "- Before review, grep the docs for every name, command or behavior your draft makes untrue, and name each in your report; never edit one.",
    );
    expect(skill).toContain(
      "- Those commits are your only writes outside the workspace's files, and you make no GitHub write: never push, merge, rebase or reset. The review, wrap-up and close-out commands in the ending make every other write.",
    );
    expect(skill).not.toContain("the GitHub writes the ticket describes");
    expect(skill).not.toContain("fix or delete each statement");
  });

  it("names the draft and passages by placeholders a session fills in", () => {
    expect(skill).toContain("`writing/agent-drafts/<spec n>.md`");
    expect(skill).toContain("`.runner/passages/<repo>-<n>`");
  });

  it("covers either scope a ticket can have", () => {
    expect(skill).toContain(
      "the Sections this ticket names, by their full heading paths",
    );
    expect(skill).toContain("on a `final-pass` ticket");
  });

  it("opens from piece:pull's committed draft and printed headings, with no pull of its own", () => {
    expect(skill).toContain(
      "When `/start-issue` ran `npm run piece:pull -- <repo> <n>`, it committed the Agent draft on the ticket's branch and printed the Deliverable's ID and the draft's Sections by heading path.",
    );
    expect(skill).toContain(
      "A session that reached this skill without `/start-issue`, or holds no such output, runs `npm run piece:pull -- <repo> <n>` first in a call of its own, with no pipe,",
    );
    expect(skill).toContain(
      "Read only the Sections you draft, and an earlier Section you open for what leads into them, each by its printed heading path; never read the whole Agent draft or the Deliverable's Doc.",
    );
    expect(skill).toContain(
      "`piece:pull` brought the Deliverable's Doc into it and committed it on the ticket's branch.",
    );
    expect(skill).not.toContain("doc:print");
    expect(skill).not.toContain("Pull rules");
    expect(skill).not.toContain("Your pull brought");
  });

  it("leaves the run's implement step its own pull line", () => {
    expect(stepPrompt).toContain(
      "The runner's pull already brought the Deliverable's Doc into it and committed it on the ticket's branch.",
    );
    expect(stepPrompt).not.toContain("piece:pull");
  });

  it("says the draft reaches the Doc only through the run's push", () => {
    expect(skill).toContain(
      "reaches the Doc only through the run's push at the end of the spec",
    );
  });

  it("commits only the Agent draft, as the implement step does", () => {
    const commit =
      "`git -C <clone> add writing/agent-drafts/<spec n>.md`, then `git -C <clone> commit`. Never amend.";
    expect(skill).toContain(`Commit only the Agent draft, in the`);
    expect(skill).toContain(commit);
  });

  it("gives the ending the overlap check as its check command", () => {
    const overlap =
      "`npm run overlap -- --deliverable <the Agent draft's path in the <spec repo> clone> --passages .runner/passages/<repo>-<n>`";
    expect(skill).toContain(`then run ${overlap}.`);
    expect(skill).toContain(`Then run ${overlap}.`);
    expect(skill).not.toContain("run `npm run check`");
  });

  it("holds the length limit a run's checks would", () => {
    expect(skill).toContain(
      "keep the agent Sections' words, headings and author marks left out, within the spec's Form `Length:` line.",
    );
  });

  it("hands review and resolve to the runner and lands after the developer's go", () => {
    const steps = [
      "`npm run runner -- review <owner>/<repo> <n>`",
      "`npm run runner -- resolve <owner>/<repo> <n> .runner/resolve-<n>.json`",
      "Wait for the developer's go-ahead",
      '`npm run wrap-up -- <repo> <n> --closing "<what landed>" [--undone "<box>: <reason>"]...`',
    ];
    expectInOrder(skill, steps);
  });

  it("announces a parent's last open sub-issue before wrap-up and closes out the announced chain after it", () => {
    expectInOrder(skill, parentCloseOutSteps);
  });

  it("leaves the run's implement step without the parent's announcement or close-out", () => {
    expect(stepPrompt).not.toContain("issue:close-parent");
    expect(stepPrompt).not.toContain("close-project");
  });

  it("has no inline review and fix of its own", () => {
    expect(skill).not.toContain("follow it on the same issue;");
    expect(skill).not.toContain("Fix every finding suggested as Fix");
  });

  it("never tells the session to return an implement record", () => {
    expect(skill).not.toContain("implement record");
    expect(skill).not.toContain("Nobody is watching");
  });
});
