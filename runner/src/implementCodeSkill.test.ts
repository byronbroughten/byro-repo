import { describe, expect, it } from "vitest";

import { implementCodeSkillOf } from "./implementCodeSkill.ts";
import { implementBody } from "./implementStep.ts";

const skill = implementCodeSkillOf({
  promoteCommand: "npm run issue:promote -- <repo> <n>",
  reviewCommand: "npm run runner -- review <owner>/<repo> <n>",
  resolveCommand: "npm run runner -- resolve <owner>/<repo> <n>",
  wrapUpCommand: "npm run wrap-up -- <repo> <n>",
});

describe("implementCodeSkillOf", () => {
  it("is the user-invoked implement-code skill", () => {
    expect(skill).toMatch(
      /^---\nname: implement-code\ndescription: ".+"\ndisable-model-invocation: true\n---\n/,
    );
  });

  it("opens on a ticket reference and stops on a ready-for-human ticket", () => {
    expect(skill).toContain("state its title before starting");
    expect(skill).toContain(
      "A `ready-for-human` ticket: state its title, name the skill or steps its body says to run, and stop.",
    );
  });

  it("carries every bullet of the implement step's shared body", () => {
    Object.values(implementBody).forEach((bullet) =>
      expect(skill).toContain(bullet),
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
      "what review caught, what was fixed and what is Proposed",
      "Wait for the developer's go-ahead",
      "`ExitWorktree` with `keep`",
      '`npm run wrap-up -- <repo> <n> --closing "<what landed>" [--undone "<box>: <reason>"]...`',
    ];
    const positions = steps.map((step) => skill.indexOf(step));
    expect(positions).not.toContain(-1);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("lands a ticket with no code through --no-code", () => {
    expect(skill).toContain("`npm run wrap-up -- <repo> <n> --no-code");
  });

  it("says to run git commands one at a time", () => {
    expect(skill).toContain("Run git commands one at a time");
  });

  it("never tells the session to return an implement record", () => {
    expect(skill).not.toContain("implement record");
    expect(skill).not.toContain("Nobody is watching");
  });
});
