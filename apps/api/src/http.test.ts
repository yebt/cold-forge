import { describe, expect, test } from "bun:test";
import { clientIp, HttpError, readJson } from "./http.ts";

const status = async (p: Promise<unknown>) => {
  try {
    await p;
    return 200;
  } catch (e) {
    return e instanceof HttpError ? e.status : -1;
  }
};

const streamed = (chunks: string[]) =>
  new Request("http://x/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: new ReadableStream({
      start(c) {
        for (const chunk of chunks) c.enqueue(new TextEncoder().encode(chunk));
        c.close();
      },
    }),
  });

describe("readJson", () => {
  test("enforces the limit while streaming, without Content-Length", async () => {
    const req = streamed(['{"a":"', "x".repeat(60), '"}']);
    expect(req.headers.get("Content-Length")).toBeNull();
    expect(await status(readJson(req, 50))).toBe(413);
    expect(await readJson(streamed(['{"a":', "1}"]), 50)).toEqual({ a: 1 });
  });

  test("content type, malformed json and invalid utf-8", async () => {
    const mk = (body: BodyInit, type = "application/json") =>
      new Request("http://x/", { method: "POST", headers: { "Content-Type": type }, body });
    expect(await status(readJson(mk("{}", "text/plain")))).toBe(415);
    expect(await status(readJson(mk("{}", "application/json; charset=latin1")))).toBe(415);
    expect(await status(readJson(mk("{}", "application/json; charset=UTF-8")))).toBe(200);
    expect(await status(readJson(mk("{nope")))).toBe(400);
    expect(await status(readJson(mk(new Uint8Array([0x7b, 0xff, 0x7d]))))).toBe(400);
  });
});

describe("clientIp", () => {
  test("ignores X-Forwarded-For unless a proxy is trusted", () => {
    expect(clientIp("10.0.0.1", "1.2.3.4", 0)).toBe("10.0.0.1");
  });
  test("takes the rightmost untrusted hop", () => {
    // client spoofs "6.6.6.6"; our proxy appended the real address 1.2.3.4
    expect(clientIp("10.0.0.1", "6.6.6.6, 1.2.3.4", 1)).toBe("1.2.3.4");
    expect(clientIp("10.0.0.1", "6.6.6.6, 1.2.3.4, 10.0.0.2", 2)).toBe("1.2.3.4");
  });
  test("falls back to the socket on garbage", () => {
    expect(clientIp("10.0.0.1", "not-an-ip", 1)).toBe("10.0.0.1");
    expect(clientIp("10.0.0.1", "1.2.3.4", 3)).toBe("10.0.0.1");
    expect(clientIp(null, null, 0)).toBe("unknown");
  });
});
