// The secret scan wrap-up runs before a push: the lines each pushed commit adds, checked against secretShapes.ts,
// so a token a later commit removes is still caught. Both WrapUp/LandingPusher.ts and WrapUp/ResearchPusher.ts run it.

import { git, lines } from "./git.ts";
import { secretShapeOf } from "./secretShapes.ts";
import { WrapUpFailure } from "./WrapUpFailure.ts";

// The lines each commit in `range` (`remote..branch`, the commits a push publishes) adds in `clone`; a hit names `repo`.
export interface SecretScan {
  repo: string;
  clone: string;
  range: string;
}

interface AddedLine {
  commit: string;
  file: string;
  line: number;
  text: string;
}

const commitMarker = "commit ";

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
  // A merge commit shows no diff here: the commits it merges are in the range and show their own.
  const log = await git(
    clone,
    "-c",
    "core.quotePath=false",
    "log",
    "-p",
    "-U0",
    "--no-merges",
    "--reverse",
    "--no-color",
    "--no-ext-diff",
    `--format=${commitMarker}%h`,
    range,
  );
  return addedLinesOf(log).flatMap(({ commit, file, line, text }) => {
    const shape = secretShapeOf(text);
    return shape === undefined
      ? []
      : [`${repo} ${file}:${line} (${shape}) in ${commit}`];
  });
}

// Each line a log's commits add, with its commit, file and line number in the commit's version. A diff line starts
// with `+`, `-`, a space, `@` or `\`, so a line opening with the marker is never one.
function addedLinesOf(log: string): AddedLine[] {
  const added: AddedLine[] = [];
  let commit = "";
  let file = "";
  let line = 0;
  let isInHunk = false;
  lines(log).forEach((diffLine) => {
    if (diffLine.startsWith(commitMarker)) {
      commit = diffLine.slice(commitMarker.length);
      isInHunk = false;
    } else if (diffLine.startsWith("diff --git ")) {
      isInHunk = false;
    } else if (!isInHunk && diffLine.startsWith("+++ ")) {
      file = diffLine.slice(4).replace(/^"?b\/(.*?)"?$/, "$1");
    } else if (diffLine.startsWith("@@")) {
      isInHunk = true;
      line = Number(/\+(\d+)/.exec(diffLine)?.[1] ?? 0);
    } else if (isInHunk && diffLine.startsWith("+")) {
      added.push({ commit, file, line, text: diffLine.slice(1) });
      line += 1;
    }
  });
  return added;
}
