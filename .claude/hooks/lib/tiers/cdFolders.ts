// Where a call's later commands run after a `cd`, for the branch guard and the Bash-read guard, which both track a call's folder.

// The folders a later command may run in after a `cd` to targets: the targets alone when the `cd` surely ran and carries on, else the folders before it too.
export function foldersAfterCdOf<FD extends string | undefined>(
  folders: FD[],
  targets: FD[],
  isCarriedOn: boolean,
): FD[] {
  return [...new Set(isCarriedOn ? targets : [...folders, ...targets])];
}
