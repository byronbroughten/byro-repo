// `npm run ws:rm -- <paths>`: deletes tracked files in a Workspace through `git rm`, .claude/hooks and .claude/skills included; the rules are workspaceRm.ts's.
import { issueWorkspacesConfig } from "../runner/runnerConfig.ts";
import { workspaceRm } from "./workspaceRm.ts";

const usage =
  "Usage: npm run ws:rm -- <path>... (tracked files in a Workspace's checkouts)";

const paths = process.argv.slice(2);
if (paths.length === 0) {
  console.error(usage);
  process.exit(1);
}
const { primaryRoot, workspaceFolder } = issueWorkspacesConfig;
// npm runs a script from the package root; INIT_CWD is where the call was made.
const cwd = process.env.INIT_CWD ?? process.cwd();
const { removed, refused } = workspaceRm({
  paths,
  cwd,
  primaryRoot,
  workspaceFolder,
});
if (refused.length > 0) {
  console.error("Deleted nothing, as these paths are refused:");
  refused.forEach(({ path, why }) => console.error(`- ${path} ${why}`));
  process.exit(1);
}
removed.forEach((path) => console.log(`rm ${path}`));
