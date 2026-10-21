import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FactsFile } from "./FactsFile.ts";

const ticket = { repo: "byro-repo", number: 332 };

let stateFolder: string;

beforeEach(() => {
  stateFolder = mkdtempSync(join(tmpdir(), "facts-file-"));
});

afterEach(() => {
  rmSync(stateFolder, { recursive: true, force: true });
});

function factsPath(): string {
  return join(stateFolder, "byro-repo-332.facts.json");
}

function storedFacts(): unknown {
  return JSON.parse(readFileSync(factsPath(), "utf8"));
}

function factsFile(): FactsFile {
  return FactsFile.init(stateFolder);
}

describe("addSession", () => {
  it("starts the file with the session's account, config folder and step", () => {
    factsFile().addSession(ticket, {
      account: 2,
      configFolder: "/config/account-2",
      step: { agent: "implement", sessionId: "session-1" },
    });

    expect(storedFacts()).toEqual({
      sessions: {
        account: 2,
        configFolder: "/config/account-2",
        steps: [{ agent: "implement", sessionId: "session-1" }],
      },
    });
  });

  it("appends to the recorded steps and keeps the other facts", () => {
    factsFile()
      .setClosingFacts(ticket, { closingComment: "Landed the writer." })
      .addSession(ticket, {
        account: 1,
        configFolder: "/config/account-1",
        step: { agent: "implement", sessionId: "session-1" },
      })
      .addSession(ticket, {
        account: 1,
        configFolder: "/config/account-1",
        step: { agent: "implement", sessionId: "session-2" },
      });

    expect(storedFacts()).toEqual({
      closingComment: "Landed the writer.",
      sessions: {
        account: 1,
        configFolder: "/config/account-1",
        steps: [
          { agent: "implement", sessionId: "session-1" },
          { agent: "implement", sessionId: "session-2" },
        ],
      },
    });
  });
});

describe("write", () => {
  it("replaces the whole file with the run's facts", () => {
    factsFile()
      .setReviewFacts(ticket, { whatReviewCaught: "A stale doc link" })
      .write(ticket, {
        branches: [{ repo: "byro-repo", branch: "issue-332-facts" }],
        closingComment: "Landed the writer.",
        reviewFixes: "none",
      });

    expect(storedFacts()).toEqual({
      branches: [{ repo: "byro-repo", branch: "issue-332-facts" }],
      closingComment: "Landed the writer.",
      reviewFixes: "none",
    });
  });
});

describe("read", () => {
  const branches = [{ repo: "byro-repo", branch: "issue-332-facts" }];

  it("returns the facts written", () => {
    const facts = {
      branches,
      closingComment: "Landed the writer.",
      reviewFixes: "none" as const,
      proposals: 1,
    };

    expect(factsFile().write(ticket, facts).read(ticket)).toEqual(facts);
  });

  it("counts Defers, Proposals' old name, as Proposals", () => {
    const written = factsFile().write(ticket, {
      branches,
      closingComment: "Landed the writer.",
      ...{ defers: 2 },
    });

    expect(written.read(ticket)).toEqual({
      branches,
      closingComment: "Landed the writer.",
      proposals: 2,
    });
  });

  it("fails naming the path when there is no file", () => {
    expect(() => factsFile().read(ticket)).toThrow(
      `No facts file at ${factsPath()}`,
    );
  });

  it("fails when the file holds sessions but no branch list", () => {
    factsFile().addSession(ticket, {
      account: 1,
      configFolder: "/config/account-1",
      step: { agent: "implement", sessionId: "session-1" },
    });

    expect(() => factsFile().read(ticket)).toThrow("has no branch list");
  });

  it("fails when the file names no branches and no GitHub writes", () => {
    factsFile().write(ticket, {
      branches: [],
      closingComment: "Landed the writer.",
    });

    expect(() => factsFile().read(ticket)).toThrow(
      "names no branches to land and no GitHub writes",
    );
  });

  it("fails when the file has no closing comment", () => {
    writeFileSync(factsPath(), JSON.stringify({ branches }));

    expect(() => factsFile().read(ticket)).toThrow("has no closing comment");
  });
});

describe("setClosingFacts", () => {
  it("replaces the closing facts set before, a box left undone included", () => {
    factsFile()
      .setClosingFacts(ticket, {
        closingComment: "Landed most of it.",
        boxesUndone: [{ box: "Exported", reason: "Out of scope" }],
      })
      .setClosingFacts(ticket, { closingComment: "Landed the writer." });

    expect(storedFacts()).toEqual({ closingComment: "Landed the writer." });
  });
});

describe("setReviewFacts", () => {
  it("replaces the review facts and keeps the closing facts", () => {
    factsFile()
      .setClosingFacts(ticket, { closingComment: "Landed the writer." })
      .setReviewFacts(ticket, {
        reviewFixes: "implementer",
        whatReviewCaught: "A stale doc link",
        proposals: 2,
      })
      .setReviewFacts(ticket, { reviewFixes: "none", proposals: 0 });

    expect(storedFacts()).toEqual({
      closingComment: "Landed the writer.",
      reviewFixes: "none",
      proposals: 0,
    });
  });
});
