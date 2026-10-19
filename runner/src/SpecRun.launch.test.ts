import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FakeAgentStep } from "./FakeAgentStep.ts";
import { implementOutputSchema } from "./implementStep.ts";
import { runKnobsOf } from "./runKnobs.ts";
import type { RunResult } from "./SpecRun.ts";
import {
  addIssue,
  addSpec,
  applied,
  bodyWith,
  bodyWithTargets,
  clonePaths,
  github,
  greenUnlessRed,
  implemented,
  masterSubjects,
  notices,
  passes,
  refOf,
  reviewed,
  spec,
  specRun,
  stateFolder,
  useSpecRunHarness,
} from "./specRunHarness.ts";

useSpecRunHarness();

describe("run", () => {
  it("launches a ticket naming the app spreadsheet with that target beside its step's own tools", async () => {
    addSpec([1]);
    github.edit(1, { body: bodyWithTargets("app spreadsheet") });
    const agentStep = FakeAgentStep.init(implemented("one.ts"), reviewed());

    await specRun(agentStep, {
      knobs: runKnobsOf({
        clonePaths,
        checks: [greenUnlessRed],
        authChecks: [passes],
        allowedTools: { implement: ["Bash(npm run tsc)"] },
      }),
    }).run(spec);

    const app = [{ kind: "spreadsheet", name: "app" }];
    expect(
      agentStep.requests.map(({ targets, allowedTools }) => ({
        targets,
        allowedTools,
      })),
    ).toEqual([
      { targets: app, allowedTools: ["Bash(npm run tsc)"] },
      { targets: app, allowedTools: [] },
    ]);
  });

  it("launches a ticket naming a Doc with that Doc", async () => {
    addSpec([1]);
    github.edit(1, { body: bodyWithTargets("doc 1AbC-d_9") });
    const agentStep = FakeAgentStep.init(implemented("one.ts"), reviewed());

    await specRun(agentStep).run(spec);

    expect(agentStep.requests.map(({ targets }) => targets)).toEqual([
      [{ kind: "doc", id: "1AbC-d_9" }],
      [{ kind: "doc", id: "1AbC-d_9" }],
    ]);
  });

  it("launches a ticket naming nothing with no targets", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(implemented("one.ts"), reviewed());

    await specRun(agentStep).run(spec);

    expect(agentStep.requests.map(({ targets }) => targets)).toEqual([[], []]);
  });

  it("reads the targets just before each launch, so one added mid-run takes effect", async () => {
    addSpec([1, 2]);
    const agentStep = FakeAgentStep.init(
      implemented("one.ts", {
        act: () =>
          github.edit(2, {
            body: bodyWithTargets("dev spreadsheet", "doc docTwo"),
          }),
      }),
      reviewed(),
      implemented("two.ts"),
      reviewed(),
    );

    await specRun(agentStep).run(spec);

    const devAndDoc = [
      { kind: "spreadsheet", name: "dev" },
      { kind: "doc", id: "docTwo" },
    ];
    expect(agentStep.requests.map(({ targets }) => targets)).toEqual([
      [],
      [],
      devAndDoc,
      devAndDoc,
    ]);
  });

  it("lands an applied ticket without review or checks: one agent request, a row commit, the ticket closed with its write list", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(applied());
    const subjectsBefore = masterSubjects();

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(agentStep.requests.map(({ jsonSchema }) => jsonSchema)).toEqual([
      implementOutputSchema,
    ]);
    const progress = readFileSync(
      join(stateFolder(), "byro-repo-213.log"),
      "utf8",
    );
    expect(progress).not.toContain("checking");
    expect(masterSubjects()).toHaveLength(subjectsBefore.length + 1);
    expect(masterSubjects()[0]).toContain("#1");
    expect(github.issues.get(1)?.isOpen).toBe(false);
    const closing = github.closed.find(
      ({ issue }) => issue.number === 1,
    )?.comment;
    expect(closing).toContain(
      "- comment on byronbroughten/byro-repo#213: Posted the addendum.",
    );
  });

  it("runs a ticketless spec with its own Model fit as one ticket, closing it", async () => {
    addIssue(spec.number);
    const agentStep = FakeAgentStep.init(implemented("spec.ts"), reviewed());

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([spec]);
    expect(github.issues.get(spec.number)?.isOpen).toBe(false);
  });
});

describe("run's Model fit refusal", () => {
  it("lists each open ready-for-agent ticket with a missing or invalid section, and checks neither the spec nor other tickets", async () => {
    addSpec([1, 2, 3, 4]);
    github.edit(2, { body: "## What to build\n\nNo section.\n" });
    github.edit(3, { body: bodyWith("Haiku low") });
    github.edit(4, {
      labels: ["ready-for-human"],
      body: "## What to build\n\nNo section.\n",
    });
    const agentStep = FakeAgentStep.init();

    const result = await specRun(agentStep).run(spec);

    expect(result).toEqual<RunResult>({
      kind: "refused",
      landed: [],
      message:
        "Each open ready-for-agent ticket needs a ## Model fit section naming one of the five pairs; missing or invalid in byro-repo #2, byro-repo #3.",
    });
    expect(agentStep.requests).toEqual([]);
    expect(notices.sent).toEqual([]);
  });

  it("refuses a malformed ## Targets line beside the Model fit check, naming the ticket and the line", async () => {
    addSpec([1, 2]);
    github.edit(2, {
      body: bodyWithTargets("app spreadsheet", "the live sheet"),
    });
    const agentStep = FakeAgentStep.init();

    const result = await specRun(agentStep).run(spec);

    expect(result).toEqual<RunResult>({
      kind: "refused",
      landed: [],
      message:
        "Each ## Targets line must be `app spreadsheet`, `dev spreadsheet` or `doc <id>`; malformed in byro-repo #2 (`the live sheet`).",
    });
    expect(agentStep.requests).toEqual([]);
  });

  it("tells a ticketless spec with no section to split it or add one", async () => {
    addIssue(spec.number, { body: "## What to build\n\nA spec.\n" });

    const result = await specRun(FakeAgentStep.init()).run(spec);

    expect(result).toEqual<RunResult>({
      kind: "refused",
      landed: [],
      message:
        "byro-repo #213 has no sub-issues and no valid ## Model fit section: split it with /code-tickets, or add the section.",
    });
  });
});

describe("run's authorship refusal", () => {
  it("refuses a spec a stranger wrote, naming it and the login", async () => {
    addSpec([1]);
    github.edit(spec.number, { author: "stranger" });
    const agentStep = FakeAgentStep.init();

    const result = await specRun(agentStep).run(spec);

    expect(result).toEqual<RunResult>({
      kind: "refused",
      landed: [],
      message:
        "Only byronbroughten may write or edit the spec and each open ready-for-agent ticket; refused byro-repo #213 (written by stranger).",
    });
    expect(agentStep.requests).toEqual([]);
    expect(notices.sent).toEqual([]);
  });

  it("lists every launchable ticket a stranger wrote or another login edited", async () => {
    addSpec([1, 2, 3]);
    github.edit(2, { author: "stranger" });
    github.edit(3, { bodyEditors: ["byronbroughten", "editor"] });

    const result = await specRun(FakeAgentStep.init()).run(spec);

    expect(result).toEqual<RunResult>({
      kind: "refused",
      landed: [],
      message:
        "Only byronbroughten may write or edit the spec and each open ready-for-agent ticket; refused byro-repo #2 (written by stranger), byro-repo #3 (edited by editor).",
    });
  });

  it("trusts the developer's login, not the owner a run names", async () => {
    addSpec([1]);
    github.edit(spec.number, { author: "stranger" });

    const result = await specRun(FakeAgentStep.init(), {
      githubOwner: "stranger",
    }).run(spec);

    expect(result.message).toBe(
      "Only byronbroughten may write or edit the spec and each open ready-for-agent ticket; refused byro-repo #213 (written by stranger).",
    );
  });

  it("skips a stranger's ticket it won't launch", async () => {
    addSpec([1, 2]);
    github.edit(2, { labels: ["ready-for-human"], author: "stranger" });
    const agentStep = FakeAgentStep.init(implemented("one.ts"), reviewed());

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
  });

  it("checks a ticketless spec as its own ticket", async () => {
    addIssue(spec.number);
    github.edit(spec.number, { bodyEditors: ["editor"] });

    const result = await specRun(FakeAgentStep.init()).run(spec);

    expect(result.message).toBe(
      "Only byronbroughten may write or edit the spec and each open ready-for-agent ticket; refused byro-repo #213 (edited by editor).",
    );
  });

  it("passes a body only the developer wrote and edited", async () => {
    addSpec([1]);
    github.edit(spec.number, { bodyEditors: ["byronbroughten"] });
    github.edit(1, { bodyEditors: ["byronbroughten", "byronbroughten"] });
    const agentStep = FakeAgentStep.init(implemented("one.ts"), reviewed());

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
  });
});
