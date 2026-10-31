import { describe, expect, it } from "vitest";

import { FakeAgentStep } from "./FakeAgentStep.ts";
import { github, spec, specRun, useSpecRunHarness } from "./specRunHarness.ts";

useSpecRunHarness();

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

function decider() {
  return specRun(FakeAgentStep.init());
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
    expect(github.commentEdits).toEqual([
      {
        id: "comment-2",
        body: [
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
      },
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

  it("refuses an unknown id, a decided item and someone else's list, editing nothing", async () => {
    github.reply(spec.number, listBody, "someone");
    github.reply(
      spec.number,
      listBody
        .replace(
          "- [ ] **R7.1** · Propose `decision` · a\n  Evidence: e1\n  Recommendation: r1",
          "- [x] **R7.1** · Propose `decision` · a\n  Evidence: e1\n  Recommendation: r1\n  Decided: accepted",
        )
        .replaceAll("R7.2", "R8.1"),
    );
    const run = decider();

    await expect(
      run.decide(spec, { itemId: "R7.9", kind: "decided", text: "x" }),
    ).rejects.toThrow("No review list of byronbroughten's holds R7.9.");
    await expect(
      run.decide(spec, { itemId: "R7.1", kind: "decided", text: "x" }),
    ).rejects.toThrow("R7.1 is already decided.");
    await expect(
      run.decide(spec, { itemId: "R7.2", kind: "decided", text: "x" }),
    ).rejects.toThrow("Only someone's comment holds R7.2");
    expect(github.commentEdits).toEqual([]);
  });
});
