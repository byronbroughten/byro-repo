// Sends the crash notice for a runner that crashed; tmux.sh calls it, since a crashed run sends no end-of-run push of its own.
// Usage: node scripts/runner/crash.ts <owner/repo> <n> <exit code>.
import { NtfyNotices } from "@byronbroughten/spec-runner/NtfyNotices";

import { sendCrashPush } from "./crashPush.ts";
import { ntfyTopic, stateFolder } from "./runnerConfig.ts";

const [ownerRepo = "", number = "", code = ""] = process.argv.slice(2);
const [owner = "", repo = ""] = ownerRepo.split("/");
let topic: string | undefined;
try {
  topic = ntfyTopic();
} catch (error) {
  // The pane already shows the crash; a second throw would bury it.
  console.error(error instanceof Error ? error.message : error);
}
await sendCrashPush(
  { owner, spec: { repo, number: Number(number) }, code },
  {
    ntfy: topic === undefined ? undefined : NtfyNotices.init(topic),
    stateFolder,
  },
);
