// Writes a ticket's outcome row file into the current directory's checkout with that checkout's code, for wrap-up to
// commit. Wrap-up runs it in the merged workspace (runnerConfig.ts); takes the request as JSON, prints the written row's.
import {
  type OutcomeRowRequest,
  writeOutcomeRow,
} from "@byronbroughten/spec-runner/outcomeRowWriter";

const [request] = process.argv.slice(2);
if (request === undefined) {
  console.error("Usage: node scripts/runner/outcomeRow.ts '<request JSON>'");
  process.exitCode = 1;
} else {
  const parsed = JSON.parse(request) as OutcomeRowRequest;
  console.log(JSON.stringify(writeOutcomeRow(process.cwd(), parsed)));
}
