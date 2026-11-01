// WebFetch on a documentation host and WebSearch are free reads, in a session and a runner step alike; any other fetch gets no decision, so a session asks and a step's call is refused.
import type { Decision } from "./tiers.ts";

// By host, not URL: the risk is what an injected instruction puts in the outgoing URL, and a request to a listed host reaches only that host, since WebFetch returns a cross-host redirect rather than following it.
const docHosts = new Set([
  "developers.google.com",
  "support.google.com",
  "docs.anthropic.com",
]);
const webProtocols = new Set(["https:", "http:"]);

export function webGateDecision(
  toolName: string,
  input: Record<string, unknown>,
): Decision | undefined {
  if (toolName === "WebSearch") {
    return {
      permissionDecision: "allow",
      reason: "a search's query goes only to the search provider.",
    };
  }
  if (toolName !== "WebFetch") return undefined;
  const host = docHostOf(input.url);
  if (!host) return undefined;
  return {
    permissionDecision: "allow",
    reason: `\`${host}\` is a documentation host, and the fetch goes only to it.`,
  };
}

function docHostOf(url: unknown): string | undefined {
  if (typeof url !== "string" || !URL.canParse(url)) return undefined;
  const { protocol, hostname } = new URL(url);
  if (!webProtocols.has(protocol) || !docHosts.has(hostname)) return undefined;
  return hostname;
}
