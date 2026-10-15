import { describe, expect, it } from "vitest";

import {
  cachedOwnerLookup,
  driveGateDecision,
  type OwnerCache,
  type OwnerLookup,
} from "./driveTiers.ts";

const mine = "byronbroughten@gmail.com";
const stranger = "someone@example.com";

function memoryCache(): OwnerCache {
  const owners = new Map<string, string[]>();
  return {
    read: (fileId) => owners.get(fileId),
    write: (fileId, fileOwners) => {
      owners.set(fileId, fileOwners);
    },
  };
}

function ownersFrom(owners: Record<string, string[]>): OwnerLookup {
  return async (fileId) => owners[fileId];
}

async function decisionOf(
  toolName: string,
  input: Record<string, unknown>,
  ownersOf: OwnerLookup = ownersFrom({}),
) {
  return driveGateDecision({ toolName, input, ownersOf });
}

describe("driveGateDecision", () => {
  it("allows a Sheets and a Docs write on a file one of the developer's accounts owns", async () => {
    const ownersOf = ownersFrom({
      sheet1: [mine],
      doc1: ["ByronBroughtenAI@gmail.com"],
    });
    const sheetsWrite = await decisionOf(
      "mcp__gworkspace__modify_sheet_values",
      { spreadsheet_id: "sheet1" },
      ownersOf,
    );
    const docsWrite = await decisionOf(
      "mcp__gworkspace__modify_doc_text",
      { document_id: "doc1" },
      ownersOf,
    );
    expect(sheetsWrite?.permissionDecision).toBe("allow");
    expect(docsWrite?.permissionDecision).toBe("allow");
  });

  it("asks for a write on a file neither account owns, naming the file and its owner", async () => {
    const decision = await decisionOf(
      "mcp__gworkspace__batch_update_doc",
      { document_id: "theirDoc" },
      ownersFrom({ theirDoc: [stranger] }),
    );
    expect(decision?.permissionDecision).toBe("ask");
    expect(decision?.reason).toContain("theirDoc");
    expect(decision?.reason).toContain(stranger);
  });

  it("asks when the owner lookup fails", async () => {
    const failing: OwnerLookup = async () => undefined;
    const decision = await decisionOf(
      "mcp__gworkspace__append_table_rows",
      { spreadsheet_id: "sheet1" },
      failing,
    );
    expect(decision?.permissionDecision).toBe("ask");
    expect(decision?.reason).toContain("sheet1");
  });

  it("allows creating, copying, importing and exporting a file, without a lookup", async () => {
    const failing: OwnerLookup = async () => undefined;
    const decisions = await Promise.all(
      [
        "create_spreadsheet",
        "create_doc",
        "create_drive_file",
        "create_drive_folder",
        "copy_drive_file",
        "import_to_google_sheets",
        "import_to_google_doc",
        "import_to_google_slides",
        "export_doc_to_pdf",
      ].map((name) =>
        decisionOf(`mcp__gworkspace__${name}`, { file_id: "f1" }, failing),
      ),
    );
    decisions.forEach((decision) =>
      expect(decision?.permissionDecision).toBe("allow"),
    );
  });

  it("asks for every access change, naming who and at what permission, even on the developer's file", async () => {
    const ownersOf = ownersFrom({ f1: [mine] });
    const grant = await decisionOf(
      "mcp__gworkspace__manage_drive_access",
      { file_id: "f1", action: "grant", share_with: stranger, role: "writer" },
      ownersOf,
    );
    expect(grant?.permissionDecision).toBe("ask");
    expect(grant?.reason).toContain(stranger);
    expect(grant?.reason).toContain("writer");

    const link = await decisionOf(
      "mcp__gworkspace__set_drive_file_permissions",
      { file_id: "f1", link_sharing: "commenter" },
      ownersOf,
    );
    expect(link?.permissionDecision).toBe("ask");
    expect(link?.reason).toContain("anyone with the link");
    expect(link?.reason).toContain("commenter");
  });

  it("asks for an update_drive_file that changes sharing, and decides one that doesn't by owner", async () => {
    const ownersOf = ownersFrom({ f1: [mine], f2: [stranger] });
    const sharing = await decisionOf(
      "mcp__gworkspace__update_drive_file",
      { file_id: "f1", writers_can_share: true },
      ownersOf,
    );
    expect(sharing?.permissionDecision).toBe("ask");
    expect(sharing?.reason).toContain("writers_can_share");

    const move = await decisionOf(
      "mcp__gworkspace__update_drive_file",
      { file_id: "f1", add_parents: "sharedFolder" },
      ownersOf,
    );
    expect(move?.permissionDecision).toBe("ask");
    expect(move?.reason).toContain("sharedFolder");

    const rename = await decisionOf(
      "mcp__gworkspace__update_drive_file",
      { file_id: "f1", name: "Renamed", writers_can_share: null },
      ownersOf,
    );
    expect(rename?.permissionDecision).toBe("allow");

    const theirs = await decisionOf(
      "mcp__gworkspace__update_drive_file",
      { file_id: "f2", name: "Renamed" },
      ownersOf,
    );
    expect(theirs?.permissionDecision).toBe("ask");
  });

  it("has no opinion on a read", async () => {
    expect(
      await decisionOf("mcp__gworkspace__read_sheet_values", {
        spreadsheet_id: "sheet1",
      }),
    ).toBeUndefined();
  });

  it("looks a file's owner up once per session, but retries a failed lookup", async () => {
    const lookedUp: string[] = [];
    const lookup: OwnerLookup = async (fileId) => {
      lookedUp.push(fileId);
      return fileId === "doc1" ? [mine] : undefined;
    };
    const ownersOf = cachedOwnerLookup(lookup, memoryCache());
    const write = (documentId: string) =>
      decisionOf(
        "mcp__gworkspace__modify_doc_text",
        { document_id: documentId },
        ownersOf,
      );
    await write("doc1");
    expect((await write("doc1"))?.permissionDecision).toBe("allow");
    await write("broken");
    await write("broken");
    expect(lookedUp).toEqual(["doc1", "broken", "broken"]);
  });

  it("asks for a write that names no file", async () => {
    expect(
      (await decisionOf("mcp__gworkspace__modify_sheet_values", {}))
        ?.permissionDecision,
    ).toBe("ask");
  });
});
