import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import type { JevClient, JevRequest, JevResult } from "./JevClient.ts";
import { JevRequestTooLargeError } from "./JevRequestTooLargeError.ts";
import { runJevStyle } from "./runJevStyle.ts";

const styleSheet = `# Fake style

## Axes

- **Evidence**: \`firsthand\` cites nothing; \`sourced\` names a source.
- **Formality**: \`general\` is plain; \`formal\` is stiff.

## Reasoning files

| When | File |
| --- | --- |
| A kettle | kettles.md |

## Openings

- **Open a piece with a loud kettle.**
- **Right after the opening, say which kettles are skipped.**

## Wording

- **Name every kettle by its colour.**
- \`general\` **Use contractions.**
- \`formal\` **Write no contractions.**
- \`sourced\` **Name the kettle's maker.**
- **Close by returning to the first kettle.**
`;

const academicSheet = `# Fake academic style

## Citations

- **Cite every kettle in APA 7.**
`;

const deliverable = `# Kettles

The kettle whistled while rain tapped on the shed roof.

The green kettle sat beside the blue one on the shelf.

## Costs

- A copper kettle costs more than a tin one.
- A tin kettle rusts within a year.

## Close

That first kettle still whistles every morning at six.
`;

const generalStyle = `Evidence: firsthand
Formality: general
Academic: no

## Overrides

- Kettles may be named by size instead of colour.
`;

describe("runJevStyle", () => {
  it("bands flags, sorts them by probability and leaves out answers under 0.5", async () => {
    const printed = await runJevStyle(
      inputs({
        answer: (rule, paragraph) => {
          if (rule === "Name every kettle by its colour.") {
            if (paragraph.startsWith("The kettle whistled")) return 0.62;
            if (paragraph.startsWith("A tin kettle")) return 0.91;
            if (paragraph.startsWith("A copper")) return 0.4;
          }
          if (rule === "Use contractions.") {
            if (paragraph.startsWith("The green")) return 0.7;
            if (paragraph.startsWith("That first")) return 0.49;
          }
          return 0.1;
        },
      }),
    );
    expect(printed.stdout).toBe(
      [
        "## Jev style",
        "",
        '- breaks 0.91: "Name every kettle by its colour." at "A tin kettle rusts within a…"',
        '- breaks 0.70: "Use contractions." at "The green kettle sat beside the…"',
        '- unsure 0.62: "Name every kettle by its colour." at "The kettle whistled while rain tapped…"',
        "",
        "3 flags: 2 breaks, 1 unsure, from 14 questions.",
      ].join("\n"),
    );
  });

  it("never asks a rule tagged for another axis value", async () => {
    const printed = await runJevStyle(inputs({}));
    expect(printed.stdout).toContain("Use contractions.");
    expect(printed.stdout).not.toContain("Write no contractions.");
    expect(printed.stdout).not.toContain("Name the kettle's maker.");
  });

  it("never reads the Axes definitions as rules", async () => {
    const printed = await runJevStyle(inputs({}));
    expect(printed.stdout).not.toContain('"Evidence"');
    expect(printed.stdout).not.toContain('"Formality"');
  });

  it("adds the academic sheet's rules for an Academic piece", async () => {
    const academicStyle =
      "Evidence: cited\nFormality: formal\nAcademic: yes\n\n## Overrides\n";
    const general = await runJevStyle(inputs({}));
    const academic = await runJevStyle(inputs({ style: academicStyle }));
    expect(general.stdout).not.toContain("Cite every kettle in APA 7.");
    expect(academic.stdout).toContain("Cite every kettle in APA 7.");
    expect(academic.stdout).toContain("Write no contractions.");
  });

  it("asks a position rule only of its own paragraphs", async () => {
    const printed = await runJevStyle(inputs({}));
    expect(linesWith(printed.stdout, "Open a piece")).toEqual([
      '- breaks 0.90: "Open a piece with a loud kettle." at "The kettle whistled while rain tapped…"',
    ]);
    expect(linesWith(printed.stdout, "Right after the opening")).toEqual([
      '- breaks 0.90: "Right after the opening, say which kettles are skipped." at "The kettle whistled while rain tapped…"',
      '- breaks 0.90: "Right after the opening, say which kettles are skipped." at "The green kettle sat beside the…"',
    ]);
    expect(linesWith(printed.stdout, "Close by returning")).toEqual([
      '- breaks 0.90: "Close by returning to the first kettle." at "That first kettle still whistles every…"',
    ]);
  });

  it("never flags text under a heading outside the named sections", async () => {
    const printed = await runJevStyle(inputs({ sections: ["Costs"] }));
    expect(printed.stdout).toContain("A copper kettle");
    expect(printed.stdout).toContain("A tin kettle");
    expect(printed.stdout).not.toContain("The kettle whistled");
    expect(printed.stdout).not.toContain("The green kettle");
    expect(printed.stdout).not.toContain("That first kettle");
  });

  it("stops, naming the position rule, when it matches no rule in the sheet", async () => {
    const sheet = styleSheet.replace(
      "Close by returning",
      "End by circling back",
    );
    await expect(runJevStyle(inputs({ sheet }))).rejects.toThrow(
      'Position rule "Close by returning" matches no rule',
    );
  });

  it("stops when a named section isn't a heading in the Deliverable", async () => {
    await expect(
      runJevStyle(inputs({ sections: ["Kettle history"] })),
    ).rejects.toThrow('No heading "Kettle history" in the Deliverable.');
  });

  it("asks a section named twice only once", async () => {
    const printed = await runJevStyle(inputs({ sections: ["Costs", "Costs"] }));
    expect(printed.stdout).toMatch(/from 4 questions\.$/);
  });

  it("stops when the Style file has no Overrides heading", async () => {
    const style = "Evidence: firsthand\nFormality: general\n";
    await expect(runJevStyle(inputs({ style }))).rejects.toThrow(
      'needs an "## Overrides" heading',
    );
  });

  it("writes the full answers as JSON beside the Deliverable", async () => {
    const run = inputs({});
    await runJevStyle(run);
    const written = JSON.parse(
      readFileSync(
        join(dirname(run.deliverablePath), "jev-style.json"),
        "utf8",
      ),
    ) as { answers: unknown[] };
    expect(written.answers).toHaveLength(14);
  });

  it("splits the questions over several requests when TypeSafe rejects the size", async () => {
    const run = {
      ...inputs({}),
      connect: (): JevClient => ({
        send: (request) => {
          if (Object.keys(request.questions).length > 4) {
            return Promise.reject(new JevRequestTooLargeError("too many"));
          }
          return Promise.resolve(answerAll(request, () => 0.9));
        },
        latestVersion: () => Promise.resolve("jev-1.13.0"),
      }),
    };
    const printed = await runJevStyle(run);
    expect(printed.stdout).toMatch(
      /14 flags: 14 breaks, 0 unsure, from 14 questions\.$/,
    );
  });
});

describe("runJevStyle on the repo's own style sheets", () => {
  it("finds every position rule", async () => {
    const run = {
      ...inputs({}),
      styleSheetPath: "docs/writing-style.md",
      academicSheetPath: "docs/academic-writing-style.md",
    };
    await expect(runJevStyle(run)).resolves.toBeDefined();
  });
});

function linesWith(stdout: string, ruleStart: string): string[] {
  return stdout.split("\n").filter((line) => line.includes(`"${ruleStart}`));
}

type Answer = (rule: string, paragraph: string) => number;

interface Inputs {
  answer?: Answer;
  style?: string;
  sections?: string[];
  sheet?: string;
}

function inputs({
  answer = () => 0.9,
  style = generalStyle,
  sections = [],
  sheet = styleSheet,
}: Inputs) {
  const dir = mkdtempSync(join(tmpdir(), "jev-style-"));
  return {
    deliverablePath: write(dir, "deliverable.md", deliverable),
    stylePath: write(dir, "style.md", style),
    sections,
    styleSheetPath: write(dir, "writing-style.md", sheet),
    academicSheetPath: write(dir, "academic-writing-style.md", academicSheet),
    apiKey: "test-key",
    connect: () => fakeClient(answer),
  };
}

function write(dir: string, name: string, text: string): string {
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
}

// Answers each question by its rule and paragraph, read back from the instructions the command wrote.
function fakeClient(answer: Answer): JevClient {
  return {
    send: (request) => Promise.resolve(answerAll(request, answer)),
    latestVersion: () => Promise.resolve("jev-1.13.0"),
  };
}

function answerAll(request: JevRequest, answer: Answer): JevResult {
  const { paragraphs } = (request.state as { piece: { paragraphs: string[] } })
    .piece;
  const answers = Object.fromEntries(
    Object.entries(request.questions).map(([key, question]) => {
      const instructions = String(question.instructions);
      const rule = /^Style rule: "(.*)"$/m.exec(instructions)?.[1] ?? "";
      const index = Number(/paragraphs\[(\d+)\]/.exec(instructions)?.[1]);
      const noul = answer(rule, paragraphs[index] ?? "");
      return [key, { type: "noul" as const, noul }];
    }),
  );
  return {
    model: "jev-1.13.0",
    answers,
    usage: { input_tokens: 100, output_tokens: 5 },
  };
}
