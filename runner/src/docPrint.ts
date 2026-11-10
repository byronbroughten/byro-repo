// `npm run doc:print`'s core: prints a Google Doc as the Docs module's Markdown
// dialect, so a skill session reads a Doc without the gworkspace MCP. The entry,
// which names the credential file, is `scripts/runner/docPrint.ts`.

import { Docs } from "./Docs.ts";
import type { DocumentsPort } from "./Docs/googleDocs.ts";
import { RestDocuments } from "./Docs/RestDocuments.ts";

export const docPrint = {
  /** The Docs REST API as the developer, through the clasp login in the file at `credentialPath`. */
  documentsAt(credentialPath: string): DocumentsPort {
    return RestDocuments.init({ credentialPath });
  },

  /** The Markdown of the Doc `doc` names by its ID or URL. */
  async markdownOf(documents: DocumentsPort, doc: string): Promise<string> {
    const { markdown } = await Docs.init(documents).read(documentIdOf(doc));
    return markdown;
  },
};

function documentIdOf(doc: string): string {
  return /\/document\/d\/([^/?#]+)/.exec(doc)?.[1] ?? doc;
}
