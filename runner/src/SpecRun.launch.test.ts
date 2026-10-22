import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FakeAgentStep } from "./FakeAgentStep.ts";
import { FakeIssueSource } from "./FakeIssueSource.ts";
import { implementOutputSchema } from "./implementStep.ts";
import { IssueReader } from "./IssueReader.ts";
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
  haltComments,
  implemented,
  masterSubjects,
  notices,
  passes,
  refOf,
  reviewed,
  spec,
  specRun,
  stateFolder,
  ticketState,
  useSpecRunHarness,
} from "./specRunHarness.ts";

useSpecRunHarness();

// addSpec's spec body and bodyWith()'s default body, which addIssue gives a ticket or a ticketless spec, hashed outside the code under test.
const specApproval =
  "Approved body: sha256:f03a4c12746e95cbf20e943225c0246d553b4f6e4651be338714739d550f2152";
const bodyWithApproval =
  "Approved body: sha256:c558a51de72dcd2bb13e6d8af1c265d8050936ca30dd09bf3314c8f9be105fe0";

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
  it("refuses a spec a stranger wrote, naming it and the login, and prints the line that approves it", async () => {
    addSpec([1]);
    github.edit(spec.number, { author: "stranger" });
    const agentStep = FakeAgentStep.init();

    const result = await specRun(agentStep).run(spec);

    expect(result).toEqual<RunResult>({
      kind: "refused",
      landed: [],
      message: `Only byronbroughten may write or edit the spec; refused byro-repo #213 (written by stranger). To approve a body as it reads now, comment its line on it.\n\nbyro-repo #213:\n${specApproval}`,
    });
    expect(agentStep.requests).toEqual([]);
    expect(notices.sent).toEqual([]);
    expect(github.comments).toEqual([]);
  });

  it("passes a ticket a stranger wrote to the launch-time Halt", async () => {
    addSpec([1, 2]);
    github.edit(2, { author: "stranger" });
    const agentStep = FakeAgentStep.init(implemented("one.ts"), reviewed());

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    const halts = haltComments();
    expect(halts).toHaveLength(1);
    expect(halts[0]).toContain("byro-repo #2's body was written by stranger.");
  });

  it("trusts the developer's login, not the owner a run names", async () => {
    addSpec([1]);
    github.edit(spec.number, { author: "stranger" });

    const result = await specRun(FakeAgentStep.init(), {
      githubOwner: "stranger",
    }).run(spec);

    expect(result.message).toContain(
      "refused byro-repo #213 (written by stranger).",
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
      `Only byronbroughten may write or edit the spec; refused byro-repo #213 (edited by editor). To approve a body as it reads now, comment its line on it.\n\nbyro-repo #213:\n${bodyWithApproval}`,
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

  it("passes a spec another login edited once the developer approved its text", async () => {
    addSpec([1]);
    github.edit(spec.number, { bodyEditors: ["editor"] });
    github.reply(spec.number, specApproval);
    const agentStep = FakeAgentStep.init(implemented("one.ts"), reviewed());

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
  });
});

describe("run's launch-time authorship check", () => {
  it("halts a ticket another login edited since preflight, offering `approve` and `skip` without quoting its body", async () => {
    addSpec([1, 2]);
    const agentStep = editsTicketTwoMidRun();

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(agentStep.requests).toHaveLength(2);
    expect(ticketState()["byro-repo #2"]?.step).toBe("halted");
    const halts = haltComments();
    expect(halts).toHaveLength(1);
    expect(halts[0]).toContain("Failure Halt");
    expect(halts[0]).toContain("byro-repo #2's body was edited by editor.");
    expect(halts[0]).toContain(
      "https://github.com/byronbroughten/byro-repo/issues/2",
    );
    expect(halts[0]).toContain("sha256:c558a51de72d");
    expect(halts[0]).toContain("1. `approve`\n2. `skip`");
    expect(halts[0]).not.toContain("A thing.");
    expect(halts[0]).not.toContain(bodyWithApproval);
  });

  it("posts the approval on the ticket and launches it on an `approve` answer, though the edit stays in its history", async () => {
    addSpec([1, 2]);
    await specRun(editsTicketTwoMidRun()).run(spec);
    github.reply(213, "H1: approve");
    const rerunStep = FakeAgentStep.init(implemented("two.ts"), reviewed());

    const result = await specRun(rerunStep).run(spec);

    expect(result.landed).toEqual([refOf(2)]);
    expect(rerunStep.requests).toHaveLength(2);
    expect(approvalsOnTicketTwo()).toEqual([bodyWithApproval]);
    expect(github.issues.get(2)?.bodyEditors).toEqual(["editor"]);
    expect(await ticketTwoAsAStepReadsIt()).toContain("## Body (Trusted text)");
  });

  it("raises a fresh Halt when the body changed after the Halt saw it, whoever edited it", async () => {
    addSpec([1, 2]);
    await specRun(editsTicketTwoMidRun()).run(spec);
    github.edit(2, {
      body: bodyWith("Opus medium"),
      bodyEditors: ["editor", "byronbroughten"],
    });
    github.reply(213, "H1: approve");
    const rerunStep = FakeAgentStep.init();

    const result = await specRun(rerunStep).run(spec);

    expect(result.message).toBe(
      "Stopped on request: landed nothing. byro-repo #2 waits on Halt H2.",
    );
    expect(rerunStep.requests).toEqual([]);
    expect(approvalsOnTicketTwo()).toEqual([]);
    expect(haltComments()).toHaveLength(2);
  });

  it("halts a ticket edited after its approval", async () => {
    addSpec([1]);
    github.edit(1, { body: bodyWith("Opus medium"), bodyEditors: ["editor"] });
    github.reply(1, bodyWithApproval);
    const agentStep = FakeAgentStep.init();

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([]);
    expect(agentStep.requests).toEqual([]);
    expect(haltComments()[0]).toContain(
      "byro-repo #1's body was edited by editor.",
    );
  });

  it("launches a ticket reverted to text the developer approved, with no new approval", async () => {
    addSpec([1]);
    github.edit(1, { bodyEditors: ["editor", "editor"] });
    github.reply(1, bodyWithApproval);
    const agentStep = FakeAgentStep.init(implemented("one.ts"), reviewed());

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(haltComments()).toEqual([]);
  });

  it("drops a ticket halted on authorship from the run on a `skip` answer", async () => {
    addSpec([1, 2]);
    const agentStep = editsTicketTwoMidRun();

    const result = await specRun(agentStep, {
      async sleep() {
        github.reply(213, "H1: skip");
      },
    }).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(result.message).toBe(
      "Run ended: landed byro-repo #1. byro-repo #2 was skipped.",
    );
    expect(agentStep.requests).toHaveLength(2);
  });

  it("halts again on a later run when the Halt was answered `skip`, since `skip` approves nothing", async () => {
    addSpec([1, 2]);
    await specRun(editsTicketTwoMidRun(), {
      async sleep() {
        github.reply(213, "H1: skip");
      },
    }).run(spec);
    const rerunStep = FakeAgentStep.init();

    const result = await specRun(rerunStep).run(spec);

    expect(result.message).toBe(
      "Stopped on request: landed nothing. byro-repo #2 waits on Halt H2.",
    );
    expect(rerunStep.requests).toEqual([]);
    expect(approvalsOnTicketTwo()).toEqual([]);
  });
});

function approvalsOnTicketTwo(): string[] {
  return github.comments.flatMap(({ issue, body }) =>
    issue.number === 2
      ? body.split("\n").filter((line) => line.startsWith("Approved body"))
      : [],
  );
}

// Reads the fake GitHub's ticket and every comment on it, the runner's own included, as `issue:read` would.
async function ticketTwoAsAStepReadsIt(): Promise<string> {
  const source = FakeIssueSource.init();
  const { title, body, isOpen, labels, author, bodyEditors } =
    await github.issueOf(refOf(2));
  source.issues.set(2, {
    issue: refOf(2),
    title,
    isOpen,
    labels,
    parent: spec,
    subIssues: [],
    body,
    author,
    bodyEditors,
    comments: await github.authoredCommentsOf(refOf(2)),
  });
  const reader = IssueReader.init({
    source,
    developer: "byronbroughten",
    githubOwner: "byronbroughten",
    allowedRepos: ["byro-repo"],
  });
  return reader.read(["byro-repo", "2", "--body"]);
}

function editsTicketTwoMidRun(): FakeAgentStep {
  return FakeAgentStep.init(
    implemented("one.ts", {
      act: () => github.edit(2, { bodyEditors: ["editor"] }),
    }),
    reviewed(),
  );
}
