// The line sessionPairContext.ts adds after `issue:start`, so /start-issue's model-fit check reads the session's real pair.
import { latestPairOf } from "@byronbroughten/spec-runner/transcriptFacts";

const issueStartCommand = /^npm run issue:start(\s|$)/;

export function sessionPairLineOf(
  command: string,
  transcript: string,
): string | undefined {
  if (!issueStartCommand.test(command.trim())) return undefined;
  const pair = latestPairOf(transcript);
  return pair === undefined ? undefined : `This session runs ${pair}.`;
}
