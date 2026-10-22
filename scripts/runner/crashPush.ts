// Sends the push for a runner that crashed; tmux.sh calls it, since a crashed run sends no end-of-run push of its own.
// Usage: node scripts/runner/crashPush.ts <owner/repo> <n> <exit code>.
import { NtfyNotices } from "@byronbroughten/spec-runner/NtfyNotices";
import { rerunCommandOf } from "@byronbroughten/spec-runner/SpecRun";

import { ntfyTopic } from "./runnerConfig.ts";

const [ownerRepo = "", number = "", code = ""] = process.argv.slice(2);
const [owner = "", repo = ""] = ownerRepo.split("/");
const command = rerunCommandOf(owner, { repo, number: Number(number) });
let topic: string | undefined;
try {
  topic = ntfyTopic();
} catch (error) {
  // The pane already shows the crash; a second throw would bury it.
  console.error(error instanceof Error ? error.message : error);
}
if (topic !== undefined) {
  await NtfyNotices.init(topic).send({
    specTitle: `${ownerRepo} #${number}`,
    summary: `The runner exited unexpectedly with code ${code}; read its tmux pane, then rerun \`${command}\`.`,
    link: `https://github.com/${ownerRepo}/issues/${number}`,
  });
}
