// `npm run piece:pull -- <repo> <n>`: pulls a drafting ticket's Agent draft from its Deliverable's Doc into the ticket's
// issue workspace and commits it there, as the runner's pull Step does, then prints the Deliverable's ID and Section headings.
// The core is runner/src/PiecePull.ts. The Doc is read as the agent account, its token from
// .claude/hooks/lib/AgentTokenMinter.ts as `npm run doc:print` takes it, minted only once the pull reads the Doc, so a
// refusal mints nothing; the runner's clasp credential file is never read.
import { messageOf } from "@byronbroughten/spec-runner/failureText";
import { GhCli } from "@byronbroughten/spec-runner/GhCli";
import type {
  BatchUpdateRequest,
  DocumentsPort,
  GoogleDocument,
} from "@byronbroughten/spec-runner/googleDocs";
import { IssueWorkspaces } from "@byronbroughten/spec-runner/IssueWorkspaces";
import { PiecePull } from "@byronbroughten/spec-runner/PiecePull";
import { RestDocuments } from "@byronbroughten/spec-runner/RestDocuments";

import { AgentTokenMinter } from "../../.claude/hooks/lib/AgentTokenMinter.ts";
import {
  developer,
  githubOwner,
  issueWorkspacesConfig,
  pieceWorkflowOver,
  runKnobs,
  workflows,
} from "./runnerConfig.ts";

const usage = "Usage: npm run piece:pull -- <repo> <n>";

const [repo, number, ...rest] = process.argv.slice(2);
if (
  repo === undefined ||
  number === undefined ||
  !/^\d+$/.test(number) ||
  rest.length > 0
) {
  console.error(usage);
  process.exitCode = 1;
} else {
  try {
    const printed = await PiecePull.init({
      source: new GhCli(githubOwner),
      developer,
      workspaces: IssueWorkspaces.init(issueWorkspacesConfig),
      clonePaths: runKnobs.clonePaths,
      workflows: {
        ...workflows,
        piece: pieceWorkflowOver(agentDocumentsOf()),
      },
    }).pull({ repo, number: Number(number) });
    console.log(printed);
  } catch (error) {
    console.error(messageOf(error));
    process.exitCode = 1;
  }
}

// Mints the agent token on the first read rather than at start, so a refusal before the pull reads the Doc mints none.
function agentDocumentsOf(): DocumentsPort {
  let minted: Promise<RestDocuments> | undefined;
  function restOf(): Promise<RestDocuments> {
    if (minted === undefined) {
      minted = AgentTokenMinter.init()
        .current()
        .then((accessToken) => RestDocuments.init({ accessToken }));
    }
    return minted;
  }
  return {
    async documentOf(documentId: string): Promise<GoogleDocument> {
      return (await restOf()).documentOf(documentId);
    },
    async batchUpdate(
      documentId: string,
      update: BatchUpdateRequest,
    ): Promise<void> {
      await (await restOf()).batchUpdate(documentId, update);
    },
  };
}
