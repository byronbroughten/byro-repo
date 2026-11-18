import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { FakeAgentStep } from "./FakeAgentStep.ts";
import { frictionFolderOf } from "./frictionNotes.ts";
import { localDateOf } from "./localTime.ts";
import {
  addIssue,
  github,
  spec,
  specRun,
  startTime,
  stateFolder,
  useSpecRunHarness,
} from "./specRunHarness.ts";

useSpecRunHarness();

// The harness clock's date wherever the test runs, as a note takes the local date.
const today = localDateOf(startTime);

const listBody = [
  "<!-- spec-runner -->",
  "<!-- review-list ticket=#7 -->",
  "",
  "- [ ] **R7.1** · Propose `decision` · a",
  "  Evidence: e1",
  "  Recommendation: r1",
  "- [ ] **R7.2** · Propose `ticket` · b",
  "  Evidence: e2",
  "  Recommendation: r2",
].join("\n");

const decidedBody = listBody.replace(
  "  Recommendation: r1",
  "  Recommendation: r1\n  Decided: accepted",
);

function decider(sessionId?: string) {
  return specRun(FakeAgentStep.init(), { sessionId });
}

function bodies(): string[] {
  return github.comments.map(({ body }) => body);
}

describe("decide", () => {
  it("decides the item on the comment as re-fetched, keeping a box ticked meanwhile", async () => {
    github.reply(spec.number, "A note.");
    github.reply(spec.number, listBody);
    github.beforeCommentReads.push(
      () => {},
      () => {
        const [, list] = github.comments;
        if (list) {
          list.body = list.body.replace("- [ ] **R7.2**", "- [x] **R7.2**");
        }
      },
    );

    const message = await decider().decide(spec, {
      itemId: "R7.1",
      kind: "decided",
      text: "accepted",
    });

    expect(message).toBe("R7.1 decided on byro-repo #213.");
    expect(bodies()).toEqual([
      "A note.",
      [
        "<!-- spec-runner -->",
        "<!-- review-list ticket=#7 -->",
        "",
        "- [x] **R7.1** · Propose `decision` · a",
        "  Evidence: e1",
        "  Recommendation: r1",
        "  Decided: accepted",
        "- [x] **R7.2** · Propose `ticket` · b",
        "  Evidence: e2",
        "  Recommendation: r2",
      ].join("\n"),
    ]);
  });

  it("records a handled item, unticked", async () => {
    github.reply(spec.number, listBody);

    const message = await decider().decide(spec, {
      itemId: "R7.2",
      kind: "handled",
      text: "filed #12",
    });

    expect(message).toBe("R7.2 handled on byro-repo #213.");
    expect(bodies()).toEqual([`${listBody}\n  Handled: filed #12`]);
  });

  it("refuses an id no list holds, editing nothing", async () => {
    github.reply(spec.number, listBody);

    await expect(
      decider().decide(spec, { itemId: "R7.9", kind: "decided", text: "x" }),
    ).rejects.toThrow("No review list of byronbroughten's holds R7.9.");
    expect(bodies()).toEqual([listBody]);
  });

  it("refuses an item already decided, editing nothing", async () => {
    github.reply(spec.number, decidedBody);

    await expect(
      decider().decide(spec, { itemId: "R7.1", kind: "decided", text: "x" }),
    ).rejects.toThrow("R7.1 is already decided.");
    expect(bodies()).toEqual([decidedBody]);
  });

  it("refuses a list someone else authored, editing nothing", async () => {
    github.reply(spec.number, listBody, "someone");

    await expect(
      decider().decide(spec, { itemId: "R7.2", kind: "decided", text: "x" }),
    ).rejects.toThrow("Only someone's comment holds R7.2");
    expect(bodies()).toEqual([listBody]);
  });
});

const mixedBody = [
  "<!-- spec-runner -->",
  "<!-- review-list ticket=gap-check -->",
  "",
  "- [ ] **Rgap-check.1** · Gap · an ask",
  "  Evidence: e1",
  "  Recommendation: r1",
].join("\n");

// A list posted before Propose was renamed.
const deferBody = listBody.replace("Propose `decision`", "Defer `decision`");

function frictionFolder(): string {
  return frictionFolderOf(stateFolder());
}

function frictionFiles(): Record<string, string> {
  if (!existsSync(frictionFolder())) return {};
  return Object.fromEntries(
    readdirSync(frictionFolder()).map((name) => [
      name,
      readFileSync(join(frictionFolder(), name), "utf8"),
    ]),
  );
}

function decidedNoteOf(id: string, heading: string, workflow = "code"): string {
  return [
    "---",
    `id: ${id}`,
    `date: ${today}`,
    "session: s-1",
    `workflow: ${workflow}`,
    "filed-by: judge-findings",
    "source: byro-repo#213 R7.1",
    "status:",
    "---",
    "",
    heading,
    "",
    "Decided: dismissed: the rule already covers it",
    "",
  ].join("\n");
}

describe("decide's Friction note", () => {
  const dismissal = {
    itemId: "R7.1",
    kind: "decided",
    text: "dismissed: the rule already covers it",
  } as const;

  beforeEach(() => {
    addIssue(spec.number, { labels: [] });
  });

  it("files one note for a decided Propose item", async () => {
    github.reply(spec.number, listBody);

    await decider("s-1").decide(spec, dismissal);

    expect(frictionFiles()).toEqual({
      [`${today}-s-1-1.md`]: decidedNoteOf(
        `${today}-s-1-1`,
        "Propose `decision` · a",
      ),
    });
  });

  it("numbers a session's second note on the same day after its first", async () => {
    github.reply(spec.number, listBody);

    await decider("s-1").decide(spec, dismissal);
    await decider("s-1").decide(spec, { ...dismissal, itemId: "R7.2" });

    expect(Object.keys(frictionFiles())).toEqual([
      `${today}-s-1-1.md`,
      `${today}-s-1-2.md`,
    ]);
  });

  it("names the piece Workflow for a spec labelled piece", async () => {
    addIssue(spec.number, { labels: ["piece"] });
    github.reply(spec.number, listBody);

    await decider("s-1").decide(spec, dismissal);

    expect(frictionFiles()[`${today}-s-1-1.md`]).toBe(
      decidedNoteOf(`${today}-s-1-1`, "Propose `decision` · a", "piece"),
    );
  });

  it("files a pre-rename list's Defer item like a Propose", async () => {
    github.reply(spec.number, deferBody);

    await decider("s-1").decide(spec, dismissal);

    expect(frictionFiles()).toEqual({
      [`${today}-s-1-1.md`]: decidedNoteOf(
        `${today}-s-1-1`,
        "Defer `decision` · a",
      ),
    });
  });

  it("leaves the session blank and out of the id when the call has none", async () => {
    github.reply(spec.number, listBody);

    await decider().decide(spec, dismissal);

    expect(frictionFiles()).toEqual({
      [`${today}-1.md`]: decidedNoteOf(
        `${today}-1`,
        "Propose `decision` · a",
      ).replace("session: s-1", "session:"),
    });
  });

  it("files no note for an item that isn't a Propose", async () => {
    github.reply(spec.number, mixedBody);

    await decider("s-1").decide(spec, {
      ...dismissal,
      itemId: "Rgap-check.1",
    });

    expect(frictionFiles()).toEqual({});
  });

  it("files no note for a handled item", async () => {
    github.reply(spec.number, listBody);

    await decider("s-1").decide(spec, { ...dismissal, kind: "handled" });

    expect(frictionFiles()).toEqual({});
  });

  it("keeps the decision and reports a failed note after its line", async () => {
    github.reply(spec.number, listBody);
    mkdirSync(stateFolder(), { recursive: true });
    writeFileSync(frictionFolder(), "not a folder");

    const message = await decider("s-1").decide(spec, dismissal);

    const [decidedLine, failureLine] = message.split("\n");
    expect(decidedLine).toBe("R7.1 decided on byro-repo #213.");
    expect(failureLine).toMatch(/^The Friction note failed: /);
    expect(bodies()).toEqual([
      decidedBody
        .replace("accepted", dismissal.text)
        .replace("- [ ] **R7.1**", "- [x] **R7.1**"),
    ]);
  });
});
