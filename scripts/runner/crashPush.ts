// Sends the push for a runner that crashed; tmux.sh calls it, since a crashed run sends no end-of-run push of its own.
// Usage: node scripts/runner/crashPush.ts <owner/repo> <n> <exit code>.
import { NtfyNotices } from "@byronbroughten/spec-runner/NtfyNotices";

import { ntfyTopic } from "./runnerConfig.ts";

const [ownerRepo = "", number = "", code = ""] = process.argv.slice(2);
const [, repo = ""] = ownerRepo.split("/");
await NtfyNotices.init(ntfyTopic()).send({
  specTitle: `${ownerRepo} #${number}`,
  summary: `The runner exited unexpectedly with code ${code}; see .runner/${repo}-${number}.log, then rerun \`npm run runner -- ${ownerRepo} ${number}\`.`,
  link: `https://github.com/${ownerRepo}/issues/${number}`,
});
