// A `gh api` call's endpoint and the method gh sends it with, read off its words as gh reads them.
export class GhApiCall {
  readonly endpoint: string;
  readonly method: string;

  private constructor(endpoint: string, method: string) {
    this.endpoint = endpoint;
    this.method = method;
  }

  // Undefined for a flag gh api doesn't take, a flag missing its value, or other than one endpoint.
  static init(args: string[]): GhApiCall | undefined {
    const endpoints: string[] = [];
    let method: string | undefined;
    let sendsBody = false;
    let at = 0;
    while (at < args.length) {
      const word = args[at++] ?? "";
      if (!word.startsWith("-")) {
        endpoints.push(word);
        continue;
      }
      const [flag, inline] = flagPartsOf(word);
      if (apiFlags.bare.has(flag) && inline === undefined) continue;
      if (!apiFlags.valued.has(flag)) return undefined;
      const value = inline ?? args[at++];
      if (value === undefined) return undefined;
      if (apiFlags.method.has(flag)) method = value.toUpperCase();
      if (apiFlags.body.has(flag)) sendsBody = true;
    }
    const [endpoint] = endpoints;
    if (endpoint === undefined || endpoints.length > 1) return undefined;
    // gh sends a body as a POST unless a method is named.
    return new GhApiCall(endpoint, method ?? (sendsBody ? "POST" : "GET"));
  }

  get isRead(): boolean {
    return this.method === "GET";
  }

  // Marking an issue blocked by another, or adding or removing a sub-issue; the opposite call undoes each.
  get isIssueLink(): boolean {
    return (
      issueLinks.methods.has(this.method) &&
      issueLinks.endpoint.test(this.endpoint)
    );
  }

  get isCommentEdit(): boolean {
    return this.method === "PATCH" && commentEndpoint.test(this.endpoint);
  }
}

const apiFlags = {
  // Each takes a value, inline (`-XPOST`, `--method=POST`) or as the next word.
  valued: new Set([
    "-X",
    "--method",
    "-F",
    "--field",
    "-f",
    "--raw-field",
    "--input",
    "-H",
    "--header",
    "-q",
    "--jq",
    "-t",
    "--template",
    "-p",
    "--preview",
    "--hostname",
    "--cache",
  ]),
  bare: new Set([
    "-i",
    "--include",
    "--paginate",
    "--silent",
    "--slurp",
    "--verbose",
  ]),
  method: new Set(["-X", "--method"]),
  body: new Set(["-F", "--field", "-f", "--raw-field", "--input"]),
} as const;

const issueLinks = {
  methods: new Set(["POST", "DELETE"]),
  endpoint:
    /^\/?repos\/[^/]+\/[^/]+\/issues\/\d+\/(dependencies\/blocked_by(\/\d+)?|sub_issues?)$/,
} as const;

const commentEndpoint = /^\/?repos\/[^/]+\/[^/]+\/issues\/comments\/\d+$/;

function flagPartsOf(word: string): [string, string | undefined] {
  if (word.startsWith("--")) {
    const equalsAt = word.indexOf("=");
    if (equalsAt === -1) return [word, undefined];
    return [word.slice(0, equalsAt), word.slice(equalsAt + 1)];
  }
  if (word.length > 2) return [word.slice(0, 2), word.slice(2)];
  return [word, undefined];
}
