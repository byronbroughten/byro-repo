// `npm run outline:apply -- <repo> <n> --edits <path> --answer "<reply>"`: applies the Outline edits the developer's reply
// approves to the spec `<repo>#<n>`'s body, word for word. The edits file is a JSON list of the proposed edits, numbered E1 on.
// The core is runner/src/outlineApply.ts.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { messageOf } from "@byronbroughten/spec-runner/failureText";
import { GhCli } from "@byronbroughten/spec-runner/GhCli";
import { outlineApply } from "@byronbroughten/spec-runner/outlineApply";

import { developer, githubOwner } from "./runnerConfig.ts";

const usage =
  'Usage: npm run outline:apply -- <repo> <n> --edits <path> --answer "<reply>"';

try {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { edits: { type: "string" }, answer: { type: "string" } },
  });
  const [repo, number, ...rest] = positionals;
  if (
    repo === undefined ||
    !/^\d+$/.test(number ?? "") ||
    rest.length > 0 ||
    values.edits === undefined ||
    values.answer === undefined
  ) {
    throw new Error(usage);
  }
  console.log(
    await outlineApply.apply(
      { issues: new GhCli(githubOwner), developer },
      {
        spec: { repo, number: Number(number) },
        edits: JSON.parse(readFileSync(values.edits, "utf8")),
        answer: values.answer,
      },
    ),
  );
} catch (error) {
  console.error(messageOf(error));
  process.exitCode = 1;
}
