// `npm run account:switch`'s core: ranks every account with limitGuard.ts's rankAccounts, passing over leased ones,
// and switches the Active account to the top one through the switch port, printing the readings before and after.
// It reads the account leases (AccountLease.ts) and never takes one. The entry, which passes the real cswap ports,
// is `scripts/runner/accountSwitch.ts`.

import type { AccountLeaseReader, LeasedAccount } from "./AccountLease.ts";
import {
  type AccountReading,
  isUnstartedWindow,
  type LeftOutReason,
  type LimitGuardKnobs,
  rankAccounts,
  readingLabelOf,
  type UsageList,
  type UsageReader,
  windowNameOf,
} from "./limitGuard.ts";
import { localTimeOf } from "./localTime.ts";
import type { LockHolder } from "./PidLock.ts";
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
  print(line: string): void;
}

export const accountSwitch = {
  /** Switches to the best free account and returns it, or returns undefined when it switches nothing. */
  async run(ports: AccountSwitchPorts): Promise<number | undefined> {
    const { usageReader, leaseReader, switchPort, knobs, print } = ports;
    const usageList = await usageReader.read();
    const leased = leaseReader.read();
    printReadings({ title: "Before:", usageList, leased, print });
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
      for (const { account, reason } of leftOut) {
        print(
          `  account ${account}: ${leftOutLabelOf(reason, account, leased)}`,
        );
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
      print,
    });
    return best.account;
  },
};

interface ReadingsPrint {
  title: string;
  usageList: UsageList;
  leased: LeasedAccount[];
  print(line: string): void;
}

function printReadings({
  title,
  usageList,
  leased,
  print,
}: ReadingsPrint): void {
  print(title);
  for (const reading of usageList.readings) {
    const parts = [
      readingLabelOf(reading.account, reading.usage),
      ...weeklyResetLabelsOf(reading),
      holderLabelOf(reading.account, leased),
    ];
    if (reading.account === usageList.activeAccount) parts.push("Active");
    print(`  ${parts.join(", ")}`);
  }
}

function weeklyResetLabelsOf({ usage }: AccountReading): string[] {
  if (usage === undefined) return [];
  if (isUnstartedWindow(usage.sevenDay)) return ["weekly window not started"];
  return [`weekly reset ${localTimeOf(usage.sevenDay.resetsAt)}`];
}

function holderLabelOf(account: number, leased: LeasedAccount[]): string {
  const lease = leased.find((each) => each.account === account);
  if (lease === undefined) return "free";
  return heldByLabelOf(lease.holder);
}

function heldByLabelOf(holder: LockHolder | undefined): string {
  if (holder === undefined) return "held by an unreadable lease";
  return `held by pid ${holder.pid} since ${localTimeOf(new Date(holder.startedAt))}`;
}

function leftOutLabelOf(
  reason: LeftOutReason,
  account: number,
  leased: LeasedAccount[],
): string {
  if (reason.kind === "limitWait") {
    return `past its ${windowNameOf(reason.window)} threshold at ${percentOf(reason.utilization)}`;
  }
  if (reason.kind === "leased") return holderLabelOf(account, leased);
  if (reason.kind === "disabled") return "disabled in cswap";
  return "unavailable to this run";
}
