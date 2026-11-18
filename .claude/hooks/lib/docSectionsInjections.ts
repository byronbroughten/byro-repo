// Which docs a skill's body injects through `npm run doc:sections`: how the read-first gate counts a Primer's read. Pure; the printer is scripts/docSections/.
import { normalize } from "node:path";

export const docSectionsCommand = "npm run doc:sections";

// An injection's first argument, bare or quoted, is the doc it prints.
const docSectionsInjection = new RegExp(
  `!\`${docSectionsCommand} -- \\s*(?:"([^"\`]*)"|'([^'\`]*)'|([^\\s\`]+))[^\`]*\``,
  "g",
);

// The repo-relative docs a skill's `` !`npm run doc:sections -- <doc> …` `` lines print into its body, whole or by section.
export function docsInjectedBy(skillText: string): string[] {
  return [...skillText.matchAll(docSectionsInjection)].map(
    ([injection, doubleQuoted, singleQuoted, bare]) => {
      const doc = doubleQuoted ?? singleQuoted ?? bare;
      if (doc === undefined) {
        throw new Error(`\`${injection}\` matched with no doc argument`);
      }
      return normalize(doc);
    },
  );
}
