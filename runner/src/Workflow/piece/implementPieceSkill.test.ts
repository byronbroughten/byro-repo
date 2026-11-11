import { describe, expect, it } from "vitest";

import { implementPieceSkillOf } from "./implementPieceSkill.ts";
import { pieceImplementPrompt } from "./implementStep.ts";

const skill = implementPieceSkillOf({
  promoteCommand: "npm run issue:promote -- <repo> <n>",
  overlapCommand: ["npm", "run", "overlap", "--"],
  docPrintCommand: "npm run doc:print --",
  reviewCommand: "npm run runner -- review <owner>/<repo> <n>",
  resolveCommand: "npm run runner -- resolve <owner>/<repo> <n>",
  decideCommand: "npm run runner -- decide <owner>/<repo> <spec> R<n>.<k>",
  wrapUpCommand: "npm run wrap-up -- <repo> <n>",
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
      "with `<!-- agent -->` on the line under the heading. Change no other Section, never one marked `<!-- developer -->`, and no other file.",
      "Read `docs/writing-voice.md` and `docs/writing-craft.md` in full before your first prose edit.",
      "Read the spec's Supporting Material only through the Drive read tools you were given, by the file IDs the spec lists.",
      "Review, resolve and any fresh step after a handoff read the same files",
    ];
    shared.forEach((line) => {
      expect(skill).toContain(line);
      expect(stepPrompt).toContain(line);
    });
  });

  it("names the draft and passages by placeholders a session fills in", () => {
    expect(skill).toContain("`writing/agent-drafts/<spec n>.md`");
    expect(skill).toContain("`.runner/passages/<repo>-<n>`");
  });

  it("covers either scope a ticket can have", () => {
    expect(skill).toContain("the Sections this ticket names");
    expect(skill).toContain("on a `final-pass` ticket");
  });

  it("pulls the Deliverable's Doc itself, before drafting, by the runner's pull rules", () => {
    expect(skill).toContain("`npm run doc:print -- <the Deliverable's ID>`");
    expect(skill).toContain("`docs/pieces/agent-draft.md`'s Pull rules");
    expect(skill).not.toContain("The runner's pull already brought");
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
    const positions = steps.map((step) => skill.indexOf(step));
    expect(positions).not.toContain(-1);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
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
