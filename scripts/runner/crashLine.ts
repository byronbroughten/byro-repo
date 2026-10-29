// The run-ended line for a runner that exited above 1, since a crashed run writes none itself.
// crash.ts is the command tmux.sh calls.
import { EventFileNotices } from "@byronbroughten/spec-runner/EventFileNotices";
import type { IssueRef } from "@byronbroughten/spec-runner/IssueWorkspaces";
import { rerunCommandOf } from "@byronbroughten/spec-runner/SpecRun";

export interface Crash {
  owner: string;
  spec: IssueRef;
  code: string;
}

export async function writeCrashLine(
  { owner, spec, code }: Crash,
  stateFolder: string,
): Promise<void> {
  const ownerRepo = `${owner}/${spec.repo}`;
  const command = rerunCommandOf(owner, spec);
  await EventFileNotices.init(stateFolder).send({
    spec,
    specTitle: `${ownerRepo} #${spec.number}`,
    summary: `The runner exited unexpectedly with code ${code}; read its tmux pane, then rerun \`${command}\`.`,
    link: `https://github.com/${ownerRepo}/issues/${spec.number}`,
    kind: "crashed",
  });
}
