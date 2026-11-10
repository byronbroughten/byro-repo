// `npm run doc:print`'s core: prints a Google Doc as the Docs module's Markdown
// dialect, so a skill session reads a Doc without the gworkspace MCP. The entry,
// which builds the REST port on the credential file, is `scripts/runner/docPrint.ts`.

import { Docs } from "./Docs.ts";
import type { DocumentsPort } from "./Docs/googleDocs.ts";

export const docPrint = {
  /** The Markdown of the Doc `doc` names by its ID or URL. */
  async markdownOf(documents: DocumentsPort, doc: string): Promise<string> {
    const { markdown } = await Docs.init(documents).read(documentIdOf(doc));
    return markdown;
  },
};

function documentIdOf(doc: string): string {
  return /\/document\/d\/([^/?#]+)/.exec(doc)?.[1] ?? doc;
}
