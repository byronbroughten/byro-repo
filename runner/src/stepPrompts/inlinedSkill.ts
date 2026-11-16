// A skill's SKILL.md body inlined in a step's prompt, so the step spends no turn loading the skill: read from the
// ticket's issue workspace, its frontmatter dropped and each relative link made the workspace root's.
// The code and piece Workflows' review steps carry their review skill this way.

import { readFileSync } from "node:fs";
import { join, posix } from "node:path";

// Reads a file by its absolute path; tests pass a fake, so no SKILL.md need be in a fixture's workspace.
export type ReadText = (path: string) => string;

export interface SkillReadInput {
  workspacePath: string;
  skillName: string;
  readText: ReadText;
}

export const inlinedSkill = {
  // The ticket's issue workspace's copy, the one the step would otherwise load itself.
  textIn({ workspacePath, skillName, readText }: SkillReadInput): string {
    return readText(join(workspacePath, skillFolderOf(skillName), "SKILL.md"));
  },
  sectionOf(skillText: string, skillName: string): string {
    return `<skill name="${skillName}">\n${rootLinkedBodyOf(skillText, skillName)}\n</skill>`;
  },
};

export function readUtf8(path: string): string {
  return readFileSync(path, "utf8");
}

function skillFolderOf(skillName: string): string {
  return `.claude/skills/${skillName}`;
}

// The session works from the workspace root, not the skill's folder, so each relative link is made the root's.
function rootLinkedBodyOf(skillText: string, skillName: string): string {
  const skillFolder = skillFolderOf(skillName);
  return bodyOf(skillText).replace(
    /\]\(([^)\s]+)\)/g,
    (link, target: string) => {
      if (/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(target)) return link;
      return `](${posix.normalize(posix.join(skillFolder, target))})`;
    },
  );
}

function bodyOf(skillText: string): string {
  const frontmatter = /^---\n[\s\S]*?\n---\n/.exec(skillText);
  const body =
    frontmatter === null ? skillText : skillText.slice(frontmatter[0].length);
  return body.trim();
}
