// `npm run doc:print`'s core: prints a Google Doc as the Docs module's Markdown
// dialect, each H1 and H2 followed by a comment line holding its headingId, so a skill
// session reads a Doc without the gworkspace MCP. The entry,
// which builds the REST port on a token minted for the agent account, is
// `scripts/runner/docPrint.ts`.

import { Docs } from "./Docs.ts";
import { DocsRequestRefused } from "./Docs/DocsRequestRefused.ts";
import type { DocumentsPort } from "./Docs/googleDocs.ts";
import { markdownDialect } from "./Docs/markdownDialect.ts";

/** The Doc to print, by its ID or URL, and the account its port reads as. */
interface DocPrintRequest {
  doc: string;
  account: string;
}

export const docPrint = {
  /** The Markdown of the Doc `doc` names by its ID or URL, read as `account`. */
  async markdownOf(
    documents: DocumentsPort,
    { doc, account }: DocPrintRequest,
  ): Promise<string> {
    const documentId = documentIdOf(doc);
    try {
      const { markdown, headingIds } =
        await Docs.init(documents).read(documentId);
      return markdownDialect.withHeadingIds(markdown, headingIds);
    } catch (error) {
      // Docs answers a Doc the account can't see with a 404 as often as a 403.
      if (
        error instanceof DocsRequestRefused &&
        notSharedStatuses.has(error.status)
      ) {
        throw new Error(
          `The Doc ${documentId} may not be shared with the agent account, ${account} (Docs API ${error.status}).`,
        );
      }
      throw error;
    }
  },
};

const notSharedStatuses = new Set([403, 404]);

function documentIdOf(doc: string): string {
  return /\/document\/d\/([^/?#]+)/.exec(doc)?.[1] ?? doc;
}
