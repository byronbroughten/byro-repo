// Decides the context nudge: the session's context size from its transcript, and whether it has passed the ticket budget. Pure; contextNudge.ts does the I/O.

// The ticket budget in docs/agents/planning.md#ticket-size.
export const ticketBudgetTokens = 150_000;

export function contextNudgeContext(transcript: string): string | undefined {
  const size = contextSize(transcript);
  if (size === undefined || size < ticketBudgetTokens) return undefined;
  return (
    `Context nudge: this session's context is ${Math.round(size / 1000)}K tokens, past the ` +
    `${ticketBudgetTokens / 1000}K ticket budget. Finish the step you are on, then make a handoff your next step, ` +
    "per docs/agents/planning.md#handoffs: an issue comment, or a file if there is no issue. " +
    "If tsc, tests or lint are not green, the handoff lists the changed files and what still fails (tsc errors, test names), " +
    "so the next session resumes from the working tree; leave that work uncommitted. " +
    "Then recommend a fresh session to the developer."
  );
}

interface Usage {
  input_tokens?: unknown;
  cache_read_input_tokens?: unknown;
  cache_creation_input_tokens?: unknown;
}

export function contextSize(transcript: string): number | undefined {
  // Newest first, so a long transcript stops at its last assistant message.
  const lines = transcript.split("\n").reverse();
  for (const line of lines) {
    const usage = parseUsage(line);
    if (usage) return sumUsage(usage);
  }
  return undefined;
}

function parseUsage(line: string): Usage | undefined {
  try {
    return JSON.parse(line)?.message?.usage;
  } catch {
    return undefined;
  }
}

const contextTokenFields = ["input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"] as const;

function sumUsage(usage: Usage): number {
  return contextTokenFields.reduce((sum, field) => {
    const tokens = usage[field];
    return typeof tokens === "number" ? sum + tokens : sum;
  }, 0);
}
