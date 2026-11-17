import { readFileSync } from "node:fs";

// The review lists are kept as they stood before judging, split by a `=====` line, so a brief over them has every item to judge.
const listSeparator = "\n=====\n";

/** byro-repo #796, a real closed spec copied from GitHub, that the brief tests measure their output on. */
export const spec796 = {
  number: 796,
  title: "Per-ticket Workflow: one spec holds code and piece tickets",
  labels: ["ready-for-agent", "code"],
  body: textOf("body"),
  subIssueTitles: {
    797: "A ticket's own label picks its Workflow, and a mixed spec halts on an unlabelled ticket",
    798: "Ticket Steps pick their Workflow by the ticket",
    799: "Landing, checks and outcome rows pick their Workflow by the ticket",
    800: "A spec's end runs the union of its Workflows' spec-end Steps",
    801: "One gap check built from each Workflow's section",
    802: "`/project-spec` files mixed specs and `/project-tickets` gives each ticket its kind",
    803: "The runner's docs say a ticket's label picks its Workflow",
  } as Record<number, string>,
  closingCommentOf(sub: number): string {
    return textOf(`closing-${sub}`);
  },
  listsAsJudged: textOf("lists-as-judged").trimEnd().split(listSeparator),
};

function textOf(name: string): string {
  const url = new URL(`./byro-repo-796/${name}.txt`, import.meta.url);
  return readFileSync(url, "utf8");
}
