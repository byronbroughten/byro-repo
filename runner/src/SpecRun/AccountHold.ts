// A run's hold on a cswap account: the account the launch check last picked and, while the run holds one, its account lease.
// One hold is shared across a Batch's members, so a Batch holds one lease and counts as one run against the number of accounts.
// StepLauncher/LimitWaiter.ts takes and moves the lease at each step launch; RunLoop.ts releases it at Idle and wherever the run ends.
// The lease file itself is ../AccountLease.ts.

import { AccountLease } from "../AccountLease.ts";

export class AccountHold {
  private readonly stateFolder: string;
  // Kept once the lease is released, so an Idle run returns to it when it is free.
  account: number | undefined;
  private lease: AccountLease | undefined;

  constructor(stateFolder: string) {
    this.stateFolder = stateFolder;
  }

  // This hold's own lease is left out by its token, as a test's other holders share this process's pid.
  otherHoldersAccounts(): Set<number> {
    const ownToken = this.lease?.holder.token;
    const leased = AccountLease.leasedIn(this.stateFolder).flatMap(
      ({ account, holder }) => {
        if (ownToken !== undefined && holder?.token === ownToken) return [];
        return [account];
      },
    );
    return new Set(leased);
  }

  // Takes the first account's lease it can, keeping its own when its account comes up; the old lease goes only once the new one is held,
  // so no other run can take both in the gap. Undefined when another holder took every one first.
  leaseFirstOf(accounts: number[]): number | undefined {
    for (const account of accounts) {
      if (this.lease !== undefined && account === this.account) return account;
      const take = AccountLease.take(this.stateFolder, account);
      if (take.kind !== "taken") continue;
      this.lease?.release();
      this.lease = take.lease;
      this.account = account;
      return account;
    }
    return undefined;
  }

  release(): void {
    this.lease?.release();
    this.lease = undefined;
  }
}
