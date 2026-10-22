import { implementCodeSkillOf } from "@byronbroughten/spec-runner/implementCodeSkill";
import { describe, expect, it } from "vitest";

import { implementCodeCommands } from "./runnerConfig.ts";

describe("the committed /implement-code skill", () => {
  it("is the text generated from the implement step's shared body", async () => {
    await expect(
      implementCodeSkillOf(implementCodeCommands),
    ).toMatchFileSnapshot("../../runner/skills/implement-code/SKILL.md");
  });
});
