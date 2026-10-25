// The core of `npm run issue:backlink`: the `Design decision:` line docs/agents/issue-tracker.md defines, and a body whose backlink block holds it.
// issueBacklink.ts is the command, which reads and writes the body with gh.
import { existsSync } from "node:fs";
import { join, posix } from "node:path";

const backlinkPrefix = "Design decision: ";
const adrInClone = /^docs\/adr\/\d{4}-[a-z0-9-]+\.md$/;

export interface Clones {
  owner: string;
  // The workspace root, which an ADR path is relative to.
  root: string;
  clonePaths: Record<string, string>;
}

export function backlinkLineOf(adrPath: string, clones: Clones): string {
  const { repo, pathInClone } = cloneOf(posix.normalize(adrPath), clones);
  if (!adrInClone.test(pathInClone)) {
    throw new Error(
      `${adrPath} isn't an ADR path; it should be a clone's docs/adr/NNNN-slug.md.`,
    );
  }
  if (!existsSync(join(clones.root, adrPath))) {
    throw new Error(`${adrPath} has no file in the working tree.`);
  }
  return `${backlinkPrefix}${clones.owner}/${repo}/${pathInClone}`;
}

// The clone with the longest folder prefix, so `packages/framework/…` beats the root's `.`.
function cloneOf(
  path: string,
  { clonePaths }: Clones,
): { repo: string; pathInClone: string } {
  const clone = Object.entries(clonePaths)
    .filter(([, folder]) => folder === "." || path.startsWith(`${folder}/`))
    .sort(([, a], [, b]) => b.length - a.length)[0];
  if (clone === undefined) {
    throw new Error(`${path} sits in no clone of clonePaths.`);
  }
  const [repo, folder] = clone;
  const pathInClone = folder === "." ? path : path.slice(folder.length + 1);
  return { repo, pathInClone };
}

export function withBacklink(body: string, line: string): string {
  const trimmed = body.trimEnd();
  const block = backlinkBlockOf(trimmed);
  if (block.includes(line)) return body;
  const separator = block.length === 0 ? "\n\n" : "\n";
  return `${trimmed}${separator}${line}`;
}

function backlinkBlockOf(body: string): string[] {
  const lines = body.split(/\r?\n/);
  const start = lines.findLastIndex((line) => !line.startsWith(backlinkPrefix));
  return lines.slice(start + 1);
}
