// `npm run doc:print -- <Doc ID or URL>`: prints a Google Doc as the Docs module's Markdown.
// The core is runner/src/docPrint.ts; this names the Docs module's own clasp credential file, whose one-time login is the runner README's Setup section.
import { homedir } from "node:os";
import { join } from "node:path";

import { docPrint } from "@byronbroughten/spec-runner/docPrint";
import { messageOf } from "@byronbroughten/spec-runner/failureText";

const usage = "Usage: npm run doc:print -- <Doc ID or URL>";
const credentialPath = join(homedir(), ".clasprc-docs.json");

const [doc, ...rest] = process.argv.slice(2);
if (doc === undefined || rest.length > 0) {
  console.error(usage);
  process.exitCode = 1;
} else {
  try {
    process.stdout.write(
      await docPrint.markdownOf(docPrint.documentsAt(credentialPath), doc),
    );
  } catch (error) {
    console.error(messageOf(error));
    process.exitCode = 1;
  }
}
