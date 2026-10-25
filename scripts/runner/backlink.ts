// The pure core of `npm run issue:backlink`: the `Design decision:` line docs/agents/issue-tracker.md defines, and a body ending with it.
// issueBacklink.ts is the command, which reads and writes the body with gh.
const adrTail = /(?:^|\/)(docs\/adr\/\d{4}-[a-z0-9-]+\.md)$/;

export function backlinkLineOf(ownerRepo: string, adrPath: string): string {
  const tail = adrTail.exec(adrPath)?.[1];
  if (tail === undefined) {
    throw new Error(
      `${adrPath} isn't an ADR path; it should end with docs/adr/NNNN-slug.md.`,
    );
  }
  return `Design decision: ${ownerRepo}/${tail}`;
}

export function withBacklink(body: string, line: string): string {
  const trimmed = body.trimEnd();
  if (trimmed.endsWith(line)) return body;
  return `${trimmed}\n\n${line}`;
}
