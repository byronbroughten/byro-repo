import { describe, expect, it } from "vitest";

import { FakeAgentStep } from "./FakeAgentStep.ts";
import {
  addIssue,
  github,
  specRun,
  useSpecRunHarness,
} from "./specRunHarness.ts";

useSpecRunHarness();

// Each box is " " for an undecided item or "x" for a decided one.
function listBodyOf(ticket: number, boxes: string[]): string {
  return [
    "<!-- spec-runner -->",
    `<!-- review-list ticket=#${ticket} -->`,
    "",
    `**Review list** · byro-repo #${ticket}, "Ticket ${ticket}"`,
    "",
    ...boxes.map(
      (box, index) =>
        `- [${box}] **R${ticket}.${index + 1}** · Propose \`decision\` · a\n  Evidence: e\n  Recommendation: r`,
    ),
  ].join("\n");
}

// Each ticket maps to whether it is still open.
function addSpecOf(number: number, tickets: Record<number, boolean>): void {
  addIssue(number, { labels: [] });
  github.subIssues.set(number, Object.keys(tickets).map(Number));
  Object.entries(tickets).forEach(([ticket, isOpen]) => {
    addIssue(Number(ticket));
    github.edit(Number(ticket), { isOpen });
  });
}

function judgeable(): Promise<string> {
  return specRun(FakeAgentStep.init()).judgeable("byro-repo");
}

describe("judgeable", () => {
  it("lists undecided counts and ready-to-close specs, oldest first, dropping the rest", async () => {
    addSpecOf(40, { 41: true });
    github.reply(40, listBodyOf(41, ["x"]));
    addSpecOf(30, { 31: false, 32: false });
    github.reply(30, listBodyOf(31, ["x"]));
    github.reply(30, listBodyOf(32, ["x", "x"]));
    addSpecOf(20, { 21: true, 22: false });
    github.reply(20, listBodyOf(21, [" ", "x", " "]));
    github.reply(20, listBodyOf(22, [" "]));
    addIssue(10);
    github.reply(10, listBodyOf(10, [" "]));
    addIssue(5);
    github.edit(5, { isOpen: false });
    github.reply(5, listBodyOf(5, [" "]));

    expect(await judgeable()).toBe(
      [
        'byro-repo #10 · "Ticket 10" · 1 undecided',
        'byro-repo #20 · "Ticket 20" · 3 undecided',
        'byro-repo #30 · "Ticket 30" · ready to close',
      ].join("\n"),
    );
  });

  it("counts only the developer's own review lists", async () => {
    addSpecOf(20, { 21: true });
    github.reply(20, listBodyOf(21, [" "]));
    github.reply(20, listBodyOf(21, [" ", " "]), "someone");
    addSpecOf(30, { 31: false });
    github.reply(30, listBodyOf(31, [" "]), "someone");

    expect(await judgeable()).toBe('byro-repo #20 · "Ticket 20" · 1 undecided');
  });

  it("says so when nothing needs judging", async () => {
    addIssue(10);
    github.reply(10, "The **Review list** heading, quoted in a note.");

    expect(await judgeable()).toBe("Nothing in byro-repo needs judging.");
  });
});
