import { describe, expect, it } from "vitest";

import { docSectionsArgsOf, docsInjectedBy } from "./docSectionsInjections.ts";

describe("docSectionsArgsOf", () => {
  it("splits each injection's arguments, unquoting double- and single-quoted ones", () => {
    const skillText = [
      "!`npm run doc:sections -- docs/prose-style.md`",
      "Run `npm run doc:sections -- docs/agents/tickets.md` yourself.",
      `!\`npm run doc:sections -- config/docs/code-style.md Naming "Class shape" 'Type modeling'\``,
    ].join("\n");
    expect(docSectionsArgsOf(skillText)).toEqual([
      ["docs/prose-style.md"],
      ["config/docs/code-style.md", "Naming", "Class shape", "Type modeling"],
    ]);
  });

  it("skips an injection naming no doc", () => {
    expect(docSectionsArgsOf("!`npm run doc:sections -- `")).toEqual([]);
  });
});

describe("docsInjectedBy", () => {
  it("names each injected doc, bare, quoted or dotted, whatever sections follow", () => {
    const skillText = [
      "!`npm run doc:sections -- docs/prose-style.md`",
      '!`npm run doc:sections -- "./config/docs/code-style.md" Naming "Class shape"`',
      "!`npm run doc:sections -- 'docs/writing-voice.md'`",
    ].join("\n");
    expect(docsInjectedBy(skillText)).toEqual([
      "docs/prose-style.md",
      "config/docs/code-style.md",
      "docs/writing-voice.md",
    ]);
  });

  it("skips a mention in prose and an injection of another command", () => {
    const skillText = [
      "Run `npm run doc:sections -- docs/prose-style.md` yourself.",
      "!`cat docs/prose-style.md`",
      "!`npm run doc:sections -- docs/agents/tickets.md`",
    ].join("\n");
    expect(docsInjectedBy(skillText)).toEqual(["docs/agents/tickets.md"]);
  });
});
