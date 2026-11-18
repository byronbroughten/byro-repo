import { describe, expect, it } from "vitest";

import { FakeGitHub } from "./FakeGitHub.ts";
import { TicketReadier } from "./TicketReadier.ts";

const repo = "byro-repo";
const number = 12;
const issue = { repo, number };

const where = "## Where\n\nThe filer.";
const modelFit = "## Model fit\n\nOpus medium\nOne check. ~90K";
const readyBody = `## What to build\n\nA check.\n\n${where}\n\n${modelFit}`;

function githubWith(body: string, labels: string[]): FakeGitHub {
  const github = FakeGitHub.init();
  github.issues.set(number, {
    issue,
    title: "A ticket",
    body,
    isOpen: true,
    labels,
    url: "",
    author: "byronbroughten",
    bodyEditors: [],
  });
  return github;
}

function labelsOf(github: FakeGitHub): string[] | undefined {
  return github.issues.get(number)?.labels;
}

async function refusalOf(github: FakeGitHub, label: string): Promise<string> {
  const refusal = await TicketReadier.init(github)
    .ready(issue, label)
    .then(
      () => undefined,
      (error: unknown) => error,
    );
  expect(refusal).toBeInstanceOf(Error);
  return (refusal as Error).message;
}

describe("TicketReadier", () => {
  it("swaps needs-triage for the label on a body that passes", async () => {
    const github = githubWith(readyBody, ["needs-triage", "runner"]);
    await TicketReadier.init(github).ready(issue, "ready-for-agent");

    expect(labelsOf(github)).toEqual(["runner", "ready-for-agent"]);
  });

  it("refuses a body missing a section, naming it and changing no label", async () => {
    const github = githubWith(`## What to build\n\nA check.\n\n${modelFit}`, [
      "needs-triage",
    ]);
    const message = await refusalOf(github, "ready-for-interactive");

    expect(message).toContain("## Where");
    expect(labelsOf(github)).toEqual(["needs-triage"]);
  });

  it("refuses a body with no Model fit, naming it", async () => {
    const github = githubWith(`## What to build\n\nA check.\n\n${where}`, [
      "needs-triage",
    ]);

    expect(await refusalOf(github, "ready-for-agent")).toContain(
      "## Model fit",
    );
    expect(labelsOf(github)).toEqual(["needs-triage"]);
  });

  it("relabels a ready-for-human ticket with no check", async () => {
    const github = githubWith("## What to build\n\nBy hand.", ["needs-triage"]);
    await TicketReadier.init(github).ready(issue, "ready-for-human");

    expect(labelsOf(github)).toEqual(["ready-for-human"]);
  });

  describe("a spec headed for tickets", () => {
    it("is relabelled with no check when it has no parent and no Model fit", async () => {
      const github = githubWith("## Problem\n\nA gap.", [
        "needs-triage",
        "code",
      ]);
      await TicketReadier.init(github).ready(issue, "ready-for-agent");

      expect(labelsOf(github)).toEqual(["code", "ready-for-agent"]);
    });

    it("is checked when it has a Model fit, refusing one with no Where", async () => {
      const github = githubWith(`## Problem\n\nA gap.\n\n${modelFit}`, [
        "needs-triage",
        "piece",
      ]);

      expect(await refusalOf(github, "ready-for-agent")).toContain("## Where");
      expect(labelsOf(github)).toEqual(["needs-triage", "piece"]);
    });

    it("is checked when it has a parent", async () => {
      const github = githubWith("## Problem\n\nA gap.", [
        "needs-triage",
        "code",
      ]);
      github.subIssues.set(3, [number]);

      expect(await refusalOf(github, "ready-for-agent")).toContain(
        "## Model fit",
      );
    });
  });

  it("replaces a different ready label, or adds the label to an issue with no triage label", async () => {
    const relabelled = githubWith(readyBody, ["ready-for-agent", "runner"]);
    await TicketReadier.init(relabelled).ready(issue, "ready-for-interactive");
    const unlabelled = githubWith(readyBody, ["runner"]);
    await TicketReadier.init(unlabelled).ready(issue, "ready-for-agent");

    expect(labelsOf(relabelled)).toEqual(["runner", "ready-for-interactive"]);
    expect(labelsOf(unlabelled)).toEqual(["runner", "ready-for-agent"]);
  });

  it("refuses a label that isn't a ready label", async () => {
    const github = githubWith(readyBody, ["needs-triage"]);
    const message = await refusalOf(github, "needs-info");

    expect(message).toContain("ready-for-agent");
    expect(labelsOf(github)).toEqual(["needs-triage"]);
  });
});
