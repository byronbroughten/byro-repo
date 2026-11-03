import { describe, expect, it } from "vitest";

import { FakeAgentStep } from "./FakeAgentStep.ts";
import {
  addIssue,
  github,
  specRun,
  useSpecRunHarness,
} from "./specRunHarness.ts";

useSpecRunHarness();

function standalone(): Promise<string> {
  return specRun(FakeAgentStep.init()).standalone("byro-repo");
}

describe("standalone", () => {
  it("lists open ready Standalone tickets oldest first, never a spec, a spec's ticket or an Interactive ticket", async () => {
    addIssue(30);
    addIssue(10);
    addIssue(20, { labels: ["ready-for-agent", "ready-for-interactive"] });
    addIssue(40, { labels: ["ready-for-agent"] });
    github.subIssues.set(40, [41]);
    addIssue(41);
    addIssue(50, { labels: [] });
    addIssue(60);
    github.edit(60, { isOpen: false });

    expect(await standalone()).toBe(
      [
        "Launchable:",
        'byro-repo #10 · "Ticket 10"',
        'byro-repo #30 · "Ticket 30"',
        "",
        "/runner byronbroughten/byro-repo 10 30",
      ].join("\n"),
    );
  });

  it("leaves out a ticket blocked outside the list, and one blocked only by a left-out ticket, each with its reason", async () => {
    addIssue(9, { labels: [] });
    addIssue(10);
    addIssue(11);
    addIssue(12);
    addIssue(13);
    github.blockers.set(11, [9]);
    github.blockers.set(12, [11]);
    github.blockers.set(13, [10]);

    expect(await standalone()).toBe(
      [
        "Launchable:",
        'byro-repo #10 · "Ticket 10"',
        'byro-repo #13 · "Ticket 13"',
        "",
        "Left out:",
        "byro-repo #11 · it's blocked by byro-repo #9, still open; land that first, or drop it from the list.",
        "byro-repo #12 · it's blocked by byro-repo #11, still open; land that first, or drop it from the list.",
        "",
        "/runner byronbroughten/byro-repo 10 13",
      ].join("\n"),
    );
  });

  it("leaves out a ticket the Batch preflight would refuse, with the preflight's reason", async () => {
    addIssue(10, { body: "## What to build\n\nA thing.\n" });
    addIssue(11);

    expect(await standalone()).toBe(
      [
        "Launchable:",
        'byro-repo #11 · "Ticket 11"',
        "",
        "Left out:",
        "byro-repo #10 · byro-repo #10 has no sub-issues and no valid ## Model fit section: split it with /code-tickets, or add the section.",
        "",
        "/runner byronbroughten/byro-repo 11",
      ].join("\n"),
    );
  });

  it("checks a lone ticket as a Batch member", async () => {
    addIssue(9, { labels: [] });
    addIssue(10);
    github.blockers.set(10, [9]);

    expect(await standalone()).toBe(
      [
        "Left out:",
        "byro-repo #10 · it's blocked by byro-repo #9, still open; land that first, or drop it from the list.",
        "",
        "Nothing in byronbroughten/byro-repo is launchable.",
      ].join("\n"),
    );
  });

  it("says so when the repo has no ready Standalone ticket", async () => {
    addIssue(10, { labels: [] });

    expect(await standalone()).toBe(
      "Nothing in byronbroughten/byro-repo is launchable.",
    );
  });
});
