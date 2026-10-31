// Reads `<owner/repo> <n> [<n>…]`, the form a run launches with, for run.ts and every command tmux.sh calls.
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
