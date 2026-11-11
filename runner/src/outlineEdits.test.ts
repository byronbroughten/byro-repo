import { describe, expect, it } from "vitest";

import { outlineEdits } from "./outlineEdits.ts";
import type { OutlineEdit } from "./stepRecords.ts";

const body =
  "## Deliverable\n\nThe lamp was lit at dusk.\n\n## Outline\n\n- **The tower**: the keeper climbed, then the lamp was lit.\n- **The gale**: the lamp was lit again.\n\n## Facts\n\n- the keeper climbed, then the lamp was lit.\n";

const climb: OutlineEdit = {
  section: "The tower",
  oldText: "the keeper climbed, then the lamp was lit.",
  newText: "the lamp was lit before the keeper climbed.",
  reason: "The log lights the lamp first.",
};

describe("outlineEdits.applyTo", () => {
  it("replaces old text found once in the Outline, word for word, and nowhere else", () => {
    expect(outlineEdits.applyTo(body, [climb])).toEqual({
      body: "## Deliverable\n\nThe lamp was lit at dusk.\n\n## Outline\n\n- **The tower**: the lamp was lit before the keeper climbed.\n- **The gale**: the lamp was lit again.\n\n## Facts\n\n- the keeper climbed, then the lamp was lit.\n",
      unapplied: [],
    });
  });

  it("counts an edit already applied as applied, changing nothing", () => {
    const { body: applied } = outlineEdits.applyTo(body, [climb]);

    expect(outlineEdits.applyTo(applied, [climb])).toEqual({
      body: applied,
      unapplied: [],
    });
  });

  it("applies a new text holding its old text once, however often it runs", () => {
    const longer: OutlineEdit = {
      ...climb,
      newText: "at last the keeper climbed, then the lamp was lit.",
    };
    const once = outlineEdits.applyTo(body, [longer]);

    expect(outlineEdits.applyTo(once.body, [longer])).toEqual(once);
    expect(once.body).toContain(
      "- **The tower**: at last the keeper climbed, then the lamp was lit.\n",
    );
  });

  it("counts a deletion as applied once its old text is gone", () => {
    const cut: OutlineEdit = { ...climb, oldText: " again", newText: "" };
    const once = outlineEdits.applyTo(body, [cut]);

    expect(outlineEdits.applyTo(once.body, [cut])).toEqual(once);
    expect(once).toMatchObject({ unapplied: [] });
    expect(once.body).toContain("- **The gale**: the lamp was lit.\n");
  });

  it("leaves an edit whose old text is in the Outline more than once unapplied", () => {
    const twice: OutlineEdit = {
      ...climb,
      oldText: "the lamp was lit",
      newText: "the lamp burned",
    };

    expect(outlineEdits.applyTo(body, [twice])).toEqual({
      body,
      unapplied: [twice],
    });
  });

  it("leaves an edit whose old text isn't in the Outline unapplied", () => {
    const gone: OutlineEdit = { ...climb, oldText: "the tide turned." };

    expect(outlineEdits.applyTo(body, [gone])).toEqual({
      body,
      unapplied: [gone],
    });
  });

  it("leaves every edit unapplied on a body with no Outline", () => {
    const bare =
      "## Deliverable\n\nthe keeper climbed, then the lamp was lit.\n";

    expect(outlineEdits.applyTo(bare, [climb])).toEqual({
      body: bare,
      unapplied: [climb],
    });
  });

  it("applies the edits it can and keeps the rest", () => {
    const gone: OutlineEdit = { ...climb, oldText: "the tide turned." };
    const gale: OutlineEdit = {
      section: "The gale",
      oldText: "the lamp was lit again.",
      newText: "the lamp held.",
      reason: "The log never relights it.",
    };

    const applied = outlineEdits.applyTo(body, [gone, gale]);

    expect(applied.unapplied).toEqual([gone]);
    expect(applied.body).toContain("- **The gale**: the lamp held.\n");
  });

  it("takes a replacement holding `$` as written", () => {
    const priced: OutlineEdit = {
      ...climb,
      newText: "the lamp cost $& to light.",
    };

    expect(outlineEdits.applyTo(body, [priced]).body).toContain(
      "- **The tower**: the lamp cost $& to light.\n",
    );
  });
});

describe("outlineEdits.approvedOf", () => {
  const edits: OutlineEdit[] = [
    climb,
    { ...climb, oldText: "b" },
    { ...climb, oldText: "c" },
  ];

  it("reads each `approve E<n>` clause of an answer", () => {
    expect(
      outlineEdits.approvedOf(
        "H1: drop F1, approve E1; `approve E3`\nanother source F2",
        edits,
      ),
    ).toEqual([edits[0], edits[2]]);
  });

  it("approves nothing on an answer with no approve clause", () => {
    expect(outlineEdits.approvedOf("H1: drop F1", edits)).toEqual([]);
  });

  it("ignores an id past the Halt's edits", () => {
    expect(outlineEdits.approvedOf("H1: approve E9", edits)).toEqual([]);
  });
});

describe("outlineEdits.idOf", () => {
  it("numbers an edit from E1", () => {
    expect(outlineEdits.idOf(0)).toBe("E1");
  });
});
