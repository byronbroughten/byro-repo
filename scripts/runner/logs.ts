// `npm run logs -- sync | restore --sheet <id>`: copies the friction and outcome folders to a Sheet, or back, as the agent account.
// The core is runner/src/logBackup.ts; the access token comes from .claude/hooks/lib/AgentTokenMinter.ts, as `npm run doc:print` takes it, so the port this entry builds never sees the refresh token, though the minter reads it in this process; the tier row, docs/targets-and-gates.md, names that weakening.
// The Sheet ID is the caller's, since the private repo that keeps it is never read from public code.
import { messageOf } from "@byronbroughten/spec-runner/failureText";
import { frictionFolderOf } from "@byronbroughten/spec-runner/frictionNotes";
import { logBackup } from "@byronbroughten/spec-runner/logBackup";
import { RestSheetValues } from "@byronbroughten/spec-runner/RestSheetValues";

import { AgentTokenMinter } from "../../.claude/hooks/lib/AgentTokenMinter.ts";
import { outcomeFolder, stateFolder } from "./runnerConfig.ts";

const usage = "Usage: npm run logs -- sync | restore --sheet <Sheet ID>";

const [mode, flag, sheet, ...rest] = process.argv.slice(2);
if (
  (mode !== "sync" && mode !== "restore") ||
  flag !== "--sheet" ||
  sheet === undefined ||
  rest.length > 0
) {
  console.error(usage);
  process.exitCode = 1;
} else {
  try {
    const accessToken = await AgentTokenMinter.init().current();
    process.stdout.write(
      await logBackup[mode](RestSheetValues.init({ accessToken }), {
        sheet,
        frictionFolder: frictionFolderOf(stateFolder),
        outcomeFolder,
      }),
    );
  } catch (error) {
    console.error(messageOf(error));
    process.exitCode = 1;
  }
}
