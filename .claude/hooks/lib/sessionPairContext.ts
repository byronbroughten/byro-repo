// The line sessionPairContext.ts adds after `issue:start`, so /start-issue's model-fit check reads the session's real pair.
import { latestPairOf } from "@byronbroughten/spec-runner/transcriptFacts";

const issueStartCommand = /^npm run issue:start(\s|$)/;

export function isIssueStartCommand(command: string): boolean {
  return issueStartCommand.test(command.trim());
}

export function sessionPairLineOf(transcript: string): string | undefined {
  const pair = latestPairOf(transcript);
  return pair === undefined ? undefined : `This session runs ${pair}.`;
}
