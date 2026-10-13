import type { Notice, Notices } from "./Notices.ts";

// Posts a plain ntfy notification: the spec title as its title, the summary as its body and the link as its click target.
export class NtfyNotices implements Notices {
  private readonly topicUrl: string;

  constructor(topicUrl: string) {
    this.topicUrl = topicUrl;
  }

  // The topic is a long random string from gitignored local config; anyone who knows it can read the notices.
  static init(topic: string, server = "https://ntfy.sh"): NtfyNotices {
    return new NtfyNotices(`${server}/${topic}`);
  }

  async send({ specTitle, summary, link }: Notice): Promise<void> {
    const response = await fetch(this.topicUrl, {
      method: "POST",
      headers: { Title: headerValueOf(specTitle), Click: link },
      body: summary,
    });
    if (!response.ok) {
      throw new Error(`ntfy answered ${response.status} to a notice`);
    }
  }
}

// A header must be ASCII; ntfy decodes an RFC 2047 encoded word, so a title such as "A → B" survives.
function headerValueOf(text: string): string {
  if (/^[\x20-\x7e]*$/.test(text)) return text;
  return `=?UTF-8?B?${Buffer.from(text).toString("base64")}?=`;
}
