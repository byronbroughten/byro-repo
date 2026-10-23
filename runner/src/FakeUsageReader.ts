import type { UsageList, UsageReader } from "./limitGuard.ts";

// The usage reader run-loop tests script: each read returns the next scripted list, then repeats the last; an Error is thrown.
export class FakeUsageReader implements UsageReader {
  private readonly lists: (UsageList | Error)[];
  private reads = 0;

  constructor(lists: (UsageList | Error)[]) {
    this.lists = lists;
  }

  static init(...lists: (UsageList | Error)[]): FakeUsageReader {
    return new FakeUsageReader(lists);
  }

  async read(): Promise<UsageList> {
    const list = this.lists[Math.min(this.reads, this.lists.length - 1)];
    this.reads += 1;
    if (list === undefined) throw new Error("No scripted usage reading");
    if (list instanceof Error) throw list;
    return list;
  }
}
