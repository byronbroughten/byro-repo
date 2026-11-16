// `npm run doc:print -- <Doc ID or URL>`: prints a Google Doc as the Docs module's Markdown, read as the agent account.
// The core is runner/src/docPrint.ts; the access token is minted in .claude/hooks/lib/AgentTokenMinter.ts, so this entry never sees the refresh token or a credential file path.
import { docPrint } from "@byronbroughten/spec-runner/docPrint";
import { messageOf } from "@byronbroughten/spec-runner/failureText";
import { RestDocuments } from "@byronbroughten/spec-runner/RestDocuments";

import {
  agentAccount,
  AgentTokenMinter,
} from "../../.claude/hooks/lib/AgentTokenMinter.ts";

const usage = "Usage: npm run doc:print -- <Doc ID or URL>";

const [doc, ...rest] = process.argv.slice(2);
if (doc === undefined || rest.length > 0) {
  console.error(usage);
  process.exitCode = 1;
} else {
  try {
    const accessToken = await AgentTokenMinter.init().current();
    process.stdout.write(
      await docPrint.markdownOf(RestDocuments.init({ accessToken }), {
        doc,
        account: agentAccount,
      }),
    );
  } catch (error) {
    console.error(messageOf(error));
    process.exitCode = 1;
  }
}
