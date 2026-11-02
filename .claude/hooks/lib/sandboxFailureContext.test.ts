import { describe, expect, it } from "vitest";

import { sandboxContextOf, writeScopeOf } from "./sandboxFailureContext.ts";

const scope = {
  allow: ["/work/space", "/tmp", "/var/folders/q/T", "/Users/me/.npm"],
  deny: ["/Users/me/code/.git", "/tmp/claude-guardrails"],
};

describe("sandboxContextOf", () => {
  it.each([
    [
      "x509: OSStatus -26276",
      "Exit code 1\nPost https://api.github.com/graphql: tls: failed to verify certificate: x509: OSStatus -26276",
      "Go tool's TLS check",
    ],
    [
      "CONNECT tunnel failed, response 403",
      "Exit code 56\ncurl: (56) CONNECT tunnel failed, response 403",
      "`allowedDomains`",
    ],
    [
      "operation not permitted: ps",
      "Exit code 1\nps: operation not permitted: ps",
      "blocks `ps`",
    ],
    [
      "a write outside the write scope",
      "Exit code 1\ntouch: /Users/me/notes.txt: Operation not permitted",
      "denies writes to `/Users/me/notes.txt`",
    ],
    [
      "a write under claude-guardrails",
      "Exit code 1\nbash: /var/folders/x/T/claude-guardrails/s.json: Operation not permitted",
      "denies writes to `/var/folders/x/T/claude-guardrails/s.json`",
    ],
    [
      "a write under a denied folder inside an allowed one",
      "Exit code 128\nfatal: Unable to create '/tmp/claude-guardrails/a': Operation not permitted",
      "denies writes to `/tmp/claude-guardrails/a`",
    ],
    [
      "a write under a worktree's protected .claude/ folder, named relative",
      "Exit code 1\ntouch: .claude/hooks/x: Operation not permitted",
      "denies writes to `.claude/hooks/x`",
    ],
    [
      "a write to a protected .claude/ file inside the workspace",
      "Exit code 1\nbash: /work/space/.claude/settings.json: Operation not permitted",
      "denies writes to `/work/space/.claude/settings.json`",
    ],
    [
      "a Node EPERM",
      "Error: EPERM: operation not permitted, open '/Users/me/.zshrc'",
      "denies writes to `/Users/me/.zshrc`",
    ],
  ])("names the sandbox for %s", (_name, error, phrase) => {
    const context = sandboxContextOf(error, scope);
    expect(context).toContain("sandbox");
    expect(context).toContain(phrase);
    expect(context).toContain("excludedCommands");
    expect(context).toContain("dangerouslyDisableSandbox");
    expect(context).toContain("blocker");
  });

  it.each([
    "Exit code 1\ntouch: /work/space/a.txt: Operation not permitted",
    "Exit code 1\ntouch: /tmp/x/a.txt: Operation not permitted",
    "Exit code 1\ntouch: a.txt: Operation not permitted",
    "Exit code 1\ntouch: /work/space/.claude/notes.md: Operation not permitted",
    "Exit code 1\ntouch: .claude/notes.md: Operation not permitted",
    "Exit code 1\ntouch: /private/tmp/x/a.txt: Operation not permitted",
    "Exit code 1\ntouch: /private/var/folders/q/T/a.txt: Operation not permitted",
    "Exit code 1\nError: Cannot find module 'express'",
    "Exit code 1\ncurl: (6) Could not resolve host: example.invalid",
    "Exit code 2\nps is not installed",
  ])("says nothing for %s", (error) => {
    expect(sandboxContextOf(error, scope)).toBeUndefined();
  });

  it("joins the contexts of several matches", () => {
    const context = sandboxContextOf(
      "Exit code 1\nx509: OSStatus -26276\nps: operation not permitted: ps",
      scope,
    );
    expect(context).toContain("Go tool's TLS check");
    expect(context).toContain("blocks `ps`");
  });
});

describe("writeScopeOf", () => {
  it("expands ~, and adds the cwd, the temp folder and /dev", () => {
    const result = writeScopeOf(
      {
        sandbox: {
          filesystem: {
            allowWrite: ["~/.npm", "/tmp"],
            denyWrite: ["~/code/.git"],
          },
        },
      },
      { home: "/Users/me", cwd: "/work/space", tmpdir: "/var/T" },
    );
    expect(result.allow).toEqual([
      "/Users/me/.npm",
      "/tmp",
      "/work/space",
      "/var/T",
      "/dev",
    ]);
    expect(result.deny).toEqual(["/Users/me/code/.git"]);
  });

  it("reads a settings file without a sandbox block as the defaults", () => {
    expect(
      writeScopeOf(undefined, { home: "/h", cwd: "/c", tmpdir: "/t" }),
    ).toEqual({ allow: ["/c", "/t", "/dev"], deny: [] });
  });
});
