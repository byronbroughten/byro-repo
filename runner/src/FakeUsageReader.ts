import type { AccountReading, UsageReader } from "./limitGuard.ts";

// The usage reader run-loop tests script: each read returns the next scripted reading, then repeats the last; an Error is thrown.
export class FakeUsageReader implements UsageReader {
  private readonly readings: (AccountReading[] | Error)[];
  private reads = 0;

  constructor(readings: (AccountReading[] | Error)[]) {
    this.readings = readings;
  }

  static init(...readings: (AccountReading[] | Error)[]): FakeUsageReader {
    return new FakeUsageReader(readings);
  }

  async read(): Promise<AccountReading[]> {
    const reading =
      this.readings[Math.min(this.reads, this.readings.length - 1)];
    this.reads += 1;
    if (reading === undefined) throw new Error("No scripted usage reading");
    if (reading instanceof Error) throw reading;
    return reading;
  }
}
