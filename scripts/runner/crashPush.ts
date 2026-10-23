// The crash notice for a runner that exited above 1: its push, and its run-ended line, since a crashed run sends neither itself.
// crash.ts is the command tmux.sh calls.
import { EventFileNotices } from "@byronbroughten/spec-runner/EventFileNotices";
import type { IssueRef } from "@byronbroughten/spec-runner/IssueWorkspaces";
import {
  composedNotices,
  type Notices,
} from "@byronbroughten/spec-runner/Notices";
import { rerunCommandOf } from "@byronbroughten/spec-runner/SpecRun";

export interface Crash {
  owner: string;
  spec: IssueRef;
  code: string;
}

interface CrashNotices {
  // Undefined when the topic couldn't be read; the line is still written.
  ntfy: Notices | undefined;
  stateFolder: string;
}

export async function sendCrashPush(
  { owner, spec, code }: Crash,
  { ntfy, stateFolder }: CrashNotices,
): Promise<void> {
  const ownerRepo = `${owner}/${spec.repo}`;
  const command = rerunCommandOf(owner, spec);
  const eventFile = EventFileNotices.init(stateFolder);
  const notices =
    ntfy === undefined ? eventFile : composedNotices(ntfy, eventFile);
  await notices.send({
    spec,
    specTitle: `${ownerRepo} #${spec.number}`,
    summary: `The runner exited unexpectedly with code ${code}; read its tmux pane, then rerun \`${command}\`.`,
    link: `https://github.com/${ownerRepo}/issues/${spec.number}`,
    kind: "crashed",
  });
}
