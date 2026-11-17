// The account lease: one file per cswap account in the primary's state folder, next to the check slot, held while a run, a Batch
// or an interactive session's `runner review` or `resolve` uses that account, its holder naming that run's label.
// It is a PidLock, as RunLock.ts is, and a live holder is never waited on: the taker moves on to another account.
// limitGuard.ts's rankAccounts leaves out the accounts leasedIn lists; SpecRun/AccountHold.ts takes, moves and releases a holder's lease,
// and accountSwitch.ts reads them and never takes one.

import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  type AccountHolder,
  type HeldLock,
  type LockHolder,
  PidLock,
} from "./PidLock.ts";

export type AccountLeaseTake =
  { kind: "taken"; lease: AccountLease } | HeldLock;

// `holder` is undefined while its lease file is unreadable, which counts as held.
export interface LeasedAccount {
  account: number;
  holder: LockHolder | undefined;
}

export interface AccountLeaseReader {
  read(): LeasedAccount[];
}

// The holder is recorded in the lease, so the Accounts section names it.
export interface AccountLeaseRequest {
  account: number;
  holder: AccountHolder;
}

export class AccountLease extends PidLock {
  static take(
    stateFolder: string,
    { account, holder }: AccountLeaseRequest,
  ): AccountLeaseTake {
    mkdirSync(stateFolder, { recursive: true });
    const path = leasePathOf(stateFolder, account);
    const attempt = PidLock.tryTake(path, { accountHolder: holder });
    if (attempt.kind === "taken") {
      return { kind: "taken", lease: new AccountLease(path, attempt.holder) };
    }
    return attempt;
  }

  // Each account a live holder has leased, by account number; a dead holder's lease is left out.
  static leasedIn(stateFolder: string): LeasedAccount[] {
    if (!existsSync(stateFolder)) return [];
    return readdirSync(stateFolder)
      .flatMap((name) => {
        const account = accountOf(name);
        if (account === undefined) return [];
        const held = PidLock.heldAt(join(stateFolder, name));
        if (held === undefined) return [];
        return [{ account, holder: held.holder }];
      })
      .sort((a, b) => a.account - b.account);
  }

  // A session's review of the run's spec records the same label, so only a run's lease counts.
  static accountHeldBy(
    stateFolder: string,
    runLabel: string,
  ): number | undefined {
    return AccountLease.leasedIn(stateFolder).find(
      ({ holder }) => holder?.spec === runLabel && holder.kind !== "session",
    )?.account;
  }

  static readerOf(stateFolder: string): AccountLeaseReader {
    return { read: () => AccountLease.leasedIn(stateFolder) };
  }
}

const leaseFileName = /^account-(\d+)\.lease$/;

function leasePathOf(stateFolder: string, account: number): string {
  return join(stateFolder, `account-${account}.lease`);
}

function accountOf(fileName: string): number | undefined {
  const match = leaseFileName.exec(fileName);
  return match === null ? undefined : Number(match[1]);
}
