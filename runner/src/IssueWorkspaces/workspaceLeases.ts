// The lease and lease-holder types and the lease helpers IssueWorkspaces' callers and collaborators share; IssueWorkspaces.ts re-exports them.

export interface LeaseHolder {
  kind: "run" | "session";
  pid: number;
}

export interface Lease extends LeaseHolder {
  isLive: boolean;
}

export const leaseHolder = {
  isSame(a: LeaseHolder, b: LeaseHolder): boolean {
    return a.kind === b.kind && a.pid === b.pid;
  },

  // The lease when someone other than the holder holds it live, undefined when the holder may take it.
  otherLiveOf(
    lease: Lease | undefined,
    holder?: LeaseHolder,
  ): Lease | undefined {
    if (!lease?.isLive || (holder && leaseHolder.isSame(holder, lease))) {
      return undefined;
    }
    return lease;
  },

  labelOf({ kind, pid }: LeaseHolder): string {
    return `a ${kind} (pid ${pid})`;
  },
};
