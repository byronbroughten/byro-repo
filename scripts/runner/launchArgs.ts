// Reads `<owner/repo> <n> [<n>…]`, the form a run launches with, for run.ts and every command tmux.sh calls, and names the run's tmux session.
// A repeated number counts once, so the Batch's members, its tmux session and its event file agree everywhere.
import type { MemberList } from "@byronbroughten/spec-runner/SpecRun";

export interface LaunchArgs {
  owner: string;
  members: MemberList;
}

// Undefined for anything but that form.
export function launchArgsOf([ownerRepo = "", ...numbers]: string[]):
  LaunchArgs | undefined {
  const [owner, repo, ...extra] = ownerRepo.split("/");
  if (!owner || !repo || extra.length > 0) return undefined;
  if (!numbers.every((number) => /^\d+$/.test(number))) return undefined;
  const [first, ...rest] = [...new Set(numbers.map(Number))];
  if (first === undefined) return undefined;
  const restMembers = rest.map((number) => ({ repo, number }));
  return { owner, members: [{ repo, number: first }, ...restMembers] };
}

// For a helper tmux.sh calls only after tmuxSession.ts has accepted the same arguments.
export function requiredLaunchArgsOf(
  args: string[],
  script: string,
): LaunchArgs {
  const launch = launchArgsOf(args);
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
