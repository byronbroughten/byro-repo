// `npm run account:switch`'s core: ranks every account with limitGuard.ts's rankAccounts, passing over leased ones,
// and switches the Active account to the top one through the switch port, printing accountLine.ts's account lines before and after.
// It reads the account leases (AccountLease.ts) and never takes one. The entry, which passes the real cswap ports,
// is `scripts/runner/accountSwitch.ts`.

import type { AccountLeaseReader, LeasedAccount } from "./AccountLease.ts";
import { accountLine } from "./accountLine.ts";
import {
  type LeftOutAccount,
  type LimitGuardKnobs,
  rankAccounts,
  type UsageList,
  type UsageReader,
  windowNameOf,
} from "./limitGuard.ts";
import { percentOf } from "./transcriptFacts.ts";

// Makes `account` the Active one, as `cswap switch <n>` does.
export interface AccountSwitchPort {
  switchTo(account: number): Promise<void>;
}

export interface AccountSwitchPorts {
  usageReader: UsageReader;
  leaseReader: AccountLeaseReader;
  switchPort: AccountSwitchPort;
  knobs: LimitGuardKnobs;
  now(): Date;
  print(line: string): void;
}

export const accountSwitch = {
  /** Switches to the best free account and returns it, or returns undefined when it switches nothing. */
  async run(ports: AccountSwitchPorts): Promise<number | undefined> {
    const { usageReader, leaseReader, switchPort, knobs, now, print } = ports;
    const usageList = await usageReader.read();
    const leased = leaseReader.read();
    printReadings({ title: "Before:", usageList, leased, now: now(), print });
    const { ranked, leftOut } = rankAccounts({
      usageList,
      leasedAccounts: new Set(leased.map(({ account }) => account)),
      unavailableAccounts: new Set(),
      knobs,
      putActiveLast: false,
    });
    const best = ranked[0];
    if (best === undefined) {
      print(
        "No account is free; switching nothing. Choose one with `cswap switch <n>`:",
      );
      for (const each of leftOut) {
        print(`  account ${each.account}: ${leftOutLabelOf(each, leased)}`);
      }
      return undefined;
    }
    if (best.account === usageList.activeAccount) {
      print(
        `Account ${best.account}, the Active account, already ranks best; switching nothing.`,
      );
      return undefined;
    }
    if (best.usage === undefined) {
      print(
        `Warning: account ${best.account} has no usage reading, so it ranks last.`,
      );
    }
    print(`Switching to account ${best.account}, the best free account.`);
    await switchPort.switchTo(best.account);
    printReadings({
      title: "After:",
      usageList: await usageReader.read(),
      leased: leaseReader.read(),
      now: now(),
      print,
    });
    return best.account;
  },
};

interface ReadingsPrint {
  title: string;
  usageList: UsageList;
  leased: LeasedAccount[];
  now: Date;
  print(line: string): void;
}

function printReadings({
  title,
  usageList,
  leased,
  now,
  print,
}: ReadingsPrint): void {
  print(title);
  for (const line of accountLine.linesOf({ usageList, leased, now })) {
    print(line);
  }
}

function leftOutLabelOf(
  { account, reason }: LeftOutAccount,
  leased: LeasedAccount[],
): string {
  if (reason.kind === "limitWait") {
    return `past its ${windowNameOf(reason.window)} threshold at ${percentOf(reason.utilization)}`;
  }
  if (reason.kind === "leased") {
    const holder = accountLine.holderLabelOf(account, leased);
    if (holder === undefined) {
      throw new Error(
        `Account ${account} is left out as leased with no lease.`,
      );
    }
    return holder;
  }
  if (reason.kind === "disabled") return "disabled in cswap";
  if (reason.kind === "unavailable") return "unavailable to this run";
  throw new Error(`Unknown left-out reason for account ${account}.`);
}
