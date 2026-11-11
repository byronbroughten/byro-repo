import { implementPieceSkillOf } from "@byronbroughten/spec-runner/implementPieceSkill";
import { describe, expect, it } from "vitest";

import { implementPieceCommands } from "./runnerConfig.ts";

describe("the committed /implement-piece skill", () => {
  it("is the text generated from the piece implement step's strings", async () => {
    await expect(
      implementPieceSkillOf(implementPieceCommands),
    ).toMatchFileSnapshot("../../runner/skills/implement-piece/SKILL.md");
  });
});
