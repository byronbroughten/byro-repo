import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NtfyNotices } from "./NtfyNotices.ts";

interface Received {
  url: string | undefined;
  headers: IncomingHttpHeaders;
  body: string;
}

const spec = { repo: "r", number: 1 };

let server: Server;
let received: Received[];
let status: number;

beforeEach(async () => {
  received = [];
  status = 200;
  server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString()));
    request.on("end", () => {
      received.push({ url: request.url, headers: request.headers, body });
      response.writeHead(status).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function notices(): NtfyNotices {
  const { port } = server.address() as AddressInfo;
  return NtfyNotices.init("long-random-topic", `http://127.0.0.1:${port}`);
}

describe("send", () => {
  it("posts the summary to the topic, titled with the spec and clicking through to the link", async () => {
    await notices().send({
      spec,
      specTitle: "Spec runner",
      summary: "Run started: 2 tickets.",
      link: "https://github.com/o/r/issues/1",
    });

    expect(received).toEqual([
      expect.objectContaining({
        url: "/long-random-topic",
        body: "Run started: 2 tickets.",
        headers: expect.objectContaining({
          title: "Spec runner",
          click: "https://github.com/o/r/issues/1",
        }),
      }),
    ]);
  });

  it("encodes a title ntfy can't carry as a plain header", async () => {
    await notices().send({ spec, specTitle: "A → B", summary: "s", link: "l" });

    const title = String(received[0]?.headers.title);
    const encoded = /^=\?UTF-8\?B\?(.*)\?=$/.exec(title)?.[1] ?? "";
    expect(Buffer.from(encoded, "base64").toString()).toBe("A → B");
  });

  it("throws when ntfy refuses the notice", async () => {
    status = 429;

    await expect(
      notices().send({ spec, specTitle: "s", summary: "s", link: "l" }),
    ).rejects.toThrow("429");
  });
});
