import { describe, expect, it } from "vitest";

import { implementBody } from "../../stepPrompts/implementText.ts";
import {
  endingCommands,
  expectInOrder,
  parentCloseOutSteps,
} from "../../stepPrompts/interactiveSkillFixture.ts";
import { implementCodeSkillOf } from "./implementCodeSkill.ts";
import { implementPrompt } from "./implementStep.ts";

const skill = implementCodeSkillOf(endingCommands);

const stepPrompt = implementPrompt({
  issue: { repo: "byro-repo", number: 12 },
  spec: { repo: "byro-repo", number: 10 },
  title: "A ticket",
  body: "ticket body",
  labels: [],
  branch: "issue-12-a-ticket",
  branchedRepos: ["byro-repo"],
  workspacePath: "/workspace",
  promoteCommand: "npm run issue:promote -- byro-repo 12",
});

describe("implementCodeSkillOf", () => {
  it("is the user-invoked implement-code skill", () => {
    expect(skill).toMatch(
      /^---\nname: implement-code\ndescription: ".+"\ndisable-model-invocation: true\n---\n/,
    );
  });

  it("is invoked as <repo> <n>, the form the other issue skills take", () => {
    expect(skill).toContain("Invoked as /implement-code <repo> <n>.");
    expect(skill).toContain(
      "`/implement-code <repo> <n>` implements one ticket",
    );
    expect(skill).not.toContain("/implement-code <repo>#<n>");
  });

  it("opens on a ticket reference and stops on a ready-for-human ticket", () => {
    expect(skill).toContain("state its title before starting");
    expect(skill).toContain(
      "A `ready-for-human` ticket: state its title, name the skill or steps its body says to run, and stop.",
    );
  });

  it("implements a ready-for-interactive ticket in the session", () => {
    expect(skill).toContain(
      "A `ready-for-interactive` ticket is an Interactive ticket: implement it here",
    );
  });

  it("carries every bullet of the implement step's shared body", () => {
    Object.values(implementBody).forEach((bullet) =>
      expect(skill).toContain(bullet),
    );
  });

  it("sends the calls it has already decided on together", () => {
    expect(skill).toContain(
      "- Send the reads and greps you've already decided on together in one turn, and don't add a call to fill a batch.",
    );
  });

  it("says a ticket's code binds only its decision", () => {
    expect(skill).toContain("## What the ticket binds");
    expect(skill).toContain("A ticket's code binds its decision.");
  });

  it("ends with review, resolve, report, wait, ExitWorktree keep and wrap-up, in that order", () => {
    const steps = [
      "`npm run runner -- review <owner>/<repo> <n>`",
      "`npm run runner -- resolve <owner>/<repo> <n> .runner/resolve-<n>.json`",
      "each Propose on its own line, the item then `→` and its record's `recommendation`",
      "Wait for the developer's go-ahead",
      "`ExitWorktree` with `keep`",
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

  it("lands a ticket with no code through --no-code", () => {
    expect(skill).toContain("`npm run wrap-up -- <repo> <n> --no-code");
  });

  it("records a Propose the session fixed before landing as decided, not handled", () => {
    expect(skill).toContain(
      "`npm run runner -- decide <owner>/<repo> <spec> R<n>.<k> 'fixed in session · <commit>'`, never `--handled`:",
    );
  });

  it("says to run git commands one at a time", () => {
    expect(skill).toContain("Run git commands one at a time");
  });

  it("never tells the session to return an implement record", () => {
    expect(skill).not.toContain("implement record");
    expect(skill).not.toContain("Nobody is watching");
  });
});
