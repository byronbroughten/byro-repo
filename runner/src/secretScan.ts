// The secret scan wrap-up runs before a push: the lines a diff adds, checked against secretShapes.ts. Both
// WrapUp/LandingPusher.ts and WrapUp/ResearchPusher.ts run it.

import { git, lines } from "./git.ts";
import { secretShapeOf } from "./secretShapes.ts";
import { WrapUpFailure } from "./WrapUpFailure.ts";

// The lines `range`'s diff adds in `clone`; a hit names `repo`.
export interface SecretScan {
  repo: string;
  clone: string;
  range: string;
}

interface AddedLine {
  file: string;
  line: number;
  text: string;
}

// Every refusal before a push ends with this, so it reads the same whatever stopped it.
export function nothingPushedAfter(why: string): string {
  return `${why}, so nothing was pushed`;
}

// `subject` opens the failure, as in "The landed master".
export async function scanForSecrets(
  subject: string,
  scans: SecretScan[],
): Promise<void> {
  const hits: string[] = [];
  for (const scan of scans) {
    hits.push(...(await secretHitsOf(scan)));
  }
  if (hits.length === 0) return;
  throw new WrapUpFailure(
    "secret-scan",
    `${nothingPushedAfter(`${subject} adds token-shaped lines`)}:\n${hits.join("\n")}`,
  );
}

async function secretHitsOf({
  repo,
  clone,
  range,
}: SecretScan): Promise<string[]> {
  const diff = await git(
    clone,
    "-c",
    "core.quotePath=false",
    "diff",
    "-U0",
    "--no-color",
    "--no-ext-diff",
    range,
  );
  return addedLinesOf(diff).flatMap(({ file, line, text }) => {
    const shape = secretShapeOf(text);
    return shape === undefined ? [] : [`${repo} ${file}:${line} (${shape})`];
  });
}

// Each line a unified diff adds, with its file and line number in the new version.
function addedLinesOf(diff: string): AddedLine[] {
  const added: AddedLine[] = [];
  let file = "";
  let line = 0;
  let isInHunk = false;
  lines(diff).forEach((diffLine) => {
    if (diffLine.startsWith("diff --git ")) {
      isInHunk = false;
    } else if (!isInHunk && diffLine.startsWith("+++ ")) {
      file = diffLine.slice(4).replace(/^"?b\/(.*?)"?$/, "$1");
    } else if (diffLine.startsWith("@@")) {
      isInHunk = true;
      line = Number(/\+(\d+)/.exec(diffLine)?.[1] ?? 0);
    } else if (isInHunk && diffLine.startsWith("+")) {
      added.push({ file, line, text: diffLine.slice(1) });
      line += 1;
    }
  });
  return added;
}
