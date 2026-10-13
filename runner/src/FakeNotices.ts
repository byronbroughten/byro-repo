import type { Notice, Notices } from "./Notices.ts";

// The notice port run-loop tests read back.
export class FakeNotices implements Notices {
  readonly sent: Notice[] = [];

  static init(): FakeNotices {
    return new FakeNotices();
  }

  async send(notice: Notice): Promise<void> {
    this.sent.push(notice);
  }
}
