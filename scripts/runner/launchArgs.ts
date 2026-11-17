// Reads `<repo> <n> [<n>…]` or `<owner>/<repo> <n> [<n>…]`, the form a run launches with, for run.ts and every command tmux.sh calls, and names the run's tmux session.
// A bare repo resolves through the repo map as issue:start's does; a repeated number counts once, so the Batch's members, its tmux session and its event file agree everywhere.
import type { ClonePaths } from "@byronbroughten/spec-runner/clonePaths";
import type { MemberList } from "@byronbroughten/spec-runner/SpecRun";

export interface LaunchArgs {
  owner: string;
  members: MemberList;
}

export interface RepoArgs {
  owner: string;
  repo: string;
}

// The owner a bare repo name takes, and the repo map that must hold it.
export interface RepoMap {
  githubOwner: string;
  clonePaths: ClonePaths;
}

// Undefined for anything but `<repo>` the map holds or `<owner>/<repo>`.
export function repoArgsOf(
  ownerRepo: string,
  { githubOwner, clonePaths }: RepoMap,
): RepoArgs | undefined {
  if (!ownerRepo.includes("/")) {
    if (!Object.hasOwn(clonePaths, ownerRepo)) return undefined;
    return { owner: githubOwner, repo: ownerRepo };
  }
  const [owner, repo, ...extra] = ownerRepo.split("/");
  if (!owner || !repo || extra.length > 0) return undefined;
  return { owner, repo };
}

// Undefined for anything but that form.
export function launchArgsOf(
  [ownerRepo = "", ...numbers]: string[],
  repoMap: RepoMap,
): LaunchArgs | undefined {
  const repoArgs = repoArgsOf(ownerRepo, repoMap);
  if (repoArgs === undefined) return undefined;
  const { owner, repo } = repoArgs;
  if (!numbers.every((number) => /^\d+$/.test(number))) return undefined;
  const [first, ...rest] = [...new Set(numbers.map(Number))];
  if (first === undefined) return undefined;
  const restMembers = rest.map((number) => ({ repo, number }));
  return { owner, members: [{ repo, number: first }, ...restMembers] };
}

// For a helper tmux.sh calls only after tmuxSession.ts has accepted the same arguments.
export function requiredLaunchArgsOf(
  args: string[],
  repoMap: RepoMap,
  script: string,
): LaunchArgs {
  const launch = launchArgsOf(args, repoMap);
  if (launch === undefined) {
    throw new Error(`${script} can't read ${args.join(" ")}.`);
  }
  return launch;
}

// tmuxSession.ts prints it for tmux.sh; one number keeps its old name.
export function tmuxSessionOf(members: MemberList): string {
  const [{ repo }] = members;
  const numbers = members.map(({ number }) => number).join("-");
  return `runner-${repo}-${numbers}`;
}
