// Which docs a skill's body injects through `npm run doc:sections`: how the read-first gate counts a Primer's read. Pure; the printer is scripts/docSections/.
import { normalize } from "node:path";

export const docSectionsCommand = "npm run doc:sections";

// An injection naming at least one argument; its first is the doc it prints.
const docSectionsInjection = new RegExp(
  `!\`${docSectionsCommand} -- \\s*([^\\s\`][^\`]*)\``,
  "g",
);
const injectionArg = /"([^"]*)"|'([^']*)'|(\S+)/g;

// Each `` !`npm run doc:sections -- <doc> [<section>...]` `` line's arguments, unquoted, in the skill's order.
export function docSectionsArgsOf(skillText: string): string[][] {
  return [...skillText.matchAll(docSectionsInjection)].map(([, args = ""]) =>
    [...args.matchAll(injectionArg)].map(
      ([arg, doubleQuoted, singleQuoted, bare]) =>
        doubleQuoted ?? singleQuoted ?? bare ?? arg,
    ),
  );
}

// The repo-relative docs a skill's injections print into its body, whole or by section.
export function docsInjectedBy(skillText: string): string[] {
  return docSectionsArgsOf(skillText).map(([doc]) => {
    if (doc === undefined) {
      throw new Error("a doc:sections injection matched with no doc argument");
    }
    return normalize(doc);
  });
}
