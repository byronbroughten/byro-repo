// The run-ended line for a runner that exited above 1, since a crashed run writes none itself.
// crash.ts is the command tmux.sh calls; a Batch's line names its first member and goes to the Batch's event file.
import { EventFileNotices } from "@byronbroughten/spec-runner/EventFileNotices";
import { type MemberList, runText } from "@byronbroughten/spec-runner/SpecRun";

import { tmuxSessionOf } from "./launchArgs.ts";

export interface Crash {
  owner: string;
  members: MemberList;
  code: string;
}

export async function writeCrashLine(
  { owner, members, code }: Crash,
  stateFolder: string,
): Promise<void> {
  const [spec] = members;
  const ownerRepo = `${owner}/${spec.repo}`;
  const command = runText.rerunCommandOf(owner, ...members);
  await EventFileNotices.forStream(stateFolder, members).send({
    spec,
    specTitle: `${ownerRepo} #${spec.number}`,
    summary: `The runner exited unexpectedly with code ${code}; read its tmux pane with \`tmux attach -t ${tmuxSessionOf(members)}\`, then rerun \`${command}\`.`,
    link: `https://github.com/${ownerRepo}/issues/${spec.number}`,
    kind: "crashed",
  });
}
