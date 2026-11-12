import { describe, expect, it } from "vitest";

import { FakeIssueSource } from "./FakeIssueSource.ts";
import type { ReadableIssue } from "./IssueReader.ts";
import { outlineApply } from "./outlineApply.ts";
import type { OutlineEdit } from "./stepRecords.ts";

const developer = "developer";
const spec = { repo: "personal", number: 40 };
const specBody = [
  "## Reader",
  "",
  "A landlord.",
  "",
  "## Outline",
  "",
  "1. Rent rose $5 in 2019.",
  "2. Vacancy fell.",
  "",
  "## Style",
  "",
  "Plain.",
].join("\n");

const rentEdit: OutlineEdit = {
  section: "1",
  oldText: "Rent rose $5 in 2019.",
  newText: "Rent rose $7 in 2019.",
  reason: "the source says $7",
};
const vacancyEdit: OutlineEdit = {
  section: "2",
  oldText: "Vacancy fell.",
  newText: "Vacancy fell by a third.",
  reason: "the source gives the size",
};
const proposed = [rentEdit, vacancyEdit];

function sourceOf(issue: Partial<ReadableIssue> = {}): FakeIssueSource {
  const source = FakeIssueSource.init();
  source.issues.set(spec.number, {
    issue: spec,
    title: "A piece",
    isOpen: true,
    labels: [],
    parent: undefined,
    subIssues: [],
    body: specBody,
    author: developer,
    bodyEditors: [],
    titleRenamer: undefined,
    hasUnreadComments: false,
    comments: [],
    ...issue,
  });
  return source;
}

async function bodyOf(source: FakeIssueSource): Promise<string> {
  return (await source.readableIssueOf(spec)).body;
}

describe("outlineApply.apply", () => {
  it("applies only the edits the answer approves, word for word", async () => {
    const source = sourceOf();

    const message = await outlineApply.apply(
      { issues: source, developer },
      { spec, edits: proposed, answer: "approve E1, leave E2" },
    );

    expect(await bodyOf(source)).toBe(
      specBody.replace("Rent rose $5", "Rent rose $7"),
    );
    expect(message).toBe("Applied E1 to personal #40's ## Outline.");
  });

  it("writes nothing and says so when the answer approves no edit", async () => {
    const source = sourceOf();

    await expect(
      outlineApply.apply(
        { issues: source, developer },
        { spec, edits: proposed, answer: "drop F1" },
      ),
    ).rejects.toThrow("approves no edit");
    expect(await bodyOf(source)).toBe(specBody);
  });

  it("refuses a spec body that is Untrusted text", async () => {
    const source = sourceOf({ bodyEditors: ["stranger"] });

    await expect(
      outlineApply.apply(
        { issues: source, developer },
        { spec, edits: proposed, answer: "approve E1" },
      ),
    ).rejects.toThrow("Untrusted text, edited by stranger");
    expect(await bodyOf(source)).toBe(specBody);
  });

  it("applies what it can and names each edit to make by hand", async () => {
    const source = sourceOf();
    const stale = { ...vacancyEdit, oldText: "Vacancy rose." };

    await expect(
      outlineApply.apply(
        { issues: source, developer },
        { spec, edits: [rentEdit, stale], answer: "approve E1 approve E2" },
      ),
    ).rejects.toThrow(
      "Applied E1 to personal #40's ## Outline. Couldn't apply E2, whose old text isn't in the spec's `## Outline` exactly once; make it by hand: 2: replace \"Vacancy rose.\" with \"Vacancy fell by a third.\" (the source gives the size)",
    );
    expect(await bodyOf(source)).toBe(
      specBody.replace("Rent rose $5", "Rent rose $7"),
    );
  });

  it("refuses an edits file that isn't a list of Outline edits", async () => {
    await expect(
      outlineApply.apply(
        { issues: sourceOf(), developer },
        { spec, edits: [{ section: "1" }], answer: "approve E1" },
      ),
    ).rejects.toThrow("The edits aren't a list of Outline edits");
  });
});
