import { describe, expect, test } from "bun:test";
import { emptyChanges } from "@cold-forge/sync";
import { createApiClient, isSecureBaseUrl, parseRetryAfter, type FetchLike } from "./api.ts";
import { toSyncChanges } from "./mapping.ts";
import { T0, makeData, uid } from "./testkit.ts";

const TOKEN = "tok_" + "a".repeat(40);
const NOW = Date.parse("2026-10-05T12:00:00Z");

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const call = { url, init };
    calls.push(call);
    return respond(call);
  };
  return { fetch, calls };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

const page = (over: Record<string, unknown> = {}) => ({
  protocol: 1,
  cursor: "c1",
  changes: emptyChanges(),
  serverTime: "2026-10-05T12:00:00.000Z",
  ...over,
});

const syncReq = { protocol: 1 as const, cursor: null, changes: emptyChanges() };

describe("https guard", () => {
  test("allows https and localhost only", () => {
    expect(isSecureBaseUrl("https://api.coldforge.app")).toBe(true);
    expect(isSecureBaseUrl("http://localhost:3001")).toBe(true);
    expect(isSecureBaseUrl("http://127.0.0.1:3001")).toBe(true);
    expect(isSecureBaseUrl("http://[::1]:3001")).toBe(true);
    expect(isSecureBaseUrl("http://api.coldforge.app")).toBe(false);
    expect(isSecureBaseUrl("http://192.168.1.10:3001")).toBe(false);
    expect(isSecureBaseUrl("http://localhost.evil.com")).toBe(false);
    expect(isSecureBaseUrl("https://user:pass@api.coldforge.app")).toBe(false);
    expect(isSecureBaseUrl("javascript:alert(1)")).toBe(false);
    expect(isSecureBaseUrl("not a url")).toBe(false);
  });

  test("never sends anything (let alone a token) to an insecure URL", async () => {
    const { fetch, calls } = fakeFetch(() => json(200, page()));
    const api = createApiClient({ baseUrl: "http://api.example.com", fetch });
    expect(await api.sync(TOKEN, syncReq)).toEqual({ ok: false, error: { kind: "insecure" } });
    expect(await api.requestMagicLink("a@b.co", "en")).toEqual({ ok: false, error: { kind: "insecure" } });
    expect(calls).toHaveLength(0);
  });
});

describe("requests", () => {
  test("sends bearer auth without cookies or redirects", async () => {
    const { fetch, calls } = fakeFetch(() => json(200, page()));
    const api = createApiClient({ baseUrl: "https://api.example.com/", fetch, now: () => NOW });
    const r = await api.sync(TOKEN, syncReq);
    expect(r.ok).toBe(true);
    expect(calls[0]!.url).toBe("https://api.example.com/v1/sync");
    expect(calls[0]!.init.method).toBe("POST");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(calls[0]!.init.credentials).toBe("omit");
    expect(calls[0]!.init.redirect).toBe("error");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual(syncReq);
  });

  test("refuses header-unsafe tokens", async () => {
    const { fetch, calls } = fakeFetch(() => json(200, page()));
    const api = createApiClient({ baseUrl: "https://api.example.com", fetch });
    expect((await api.sync("abc\r\nX-Evil: 1" + "a".repeat(20), syncReq)).ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  test("magic link returns the request id, and only a valid one", async () => {
    const requestId = uid();
    const ok = createApiClient({ baseUrl: "https://x.dev", fetch: fakeFetch(() => json(202, { requestId })).fetch });
    expect(await ok.requestMagicLink("a@b.co", "es")).toEqual({ ok: true, value: { requestId } });
    const bad = createApiClient({ baseUrl: "https://x.dev", fetch: fakeFetch(() => json(202, { requestId: "<x>" })).fetch });
    expect(await bad.requestMagicLink("a@b.co", "es")).toEqual({ ok: false, error: { kind: "bad_response" } });
  });

  test("verify: session, wrong code, malformed session", async () => {
    const session = { token: TOKEN, expiresAt: "2026-11-05T12:00:00.000Z", user: { id: "usr_1", email: "A@B.co" } };
    const api = (res: Response) => createApiClient({ baseUrl: "https://x.dev", fetch: fakeFetch(() => res).fetch });
    expect(await api(json(200, session)).verify({ requestId: uid(), code: "123456" })).toEqual({
      ok: true,
      value: { ...session, user: { id: "usr_1", email: "a@b.co" } },
    });
    expect(await api(json(400, { error: "invalid_or_expired" })).verify({ token: TOKEN })).toEqual({
      ok: false,
      error: { kind: "invalid_or_expired" },
    });
    expect((await api(json(200, { ...session, token: "short" })).verify({ token: TOKEN })).ok).toBe(false);
  });
});

describe("errors", () => {
  test("401 -> unauthorized", async () => {
    const api = createApiClient({ baseUrl: "https://x.dev", fetch: fakeFetch(() => json(401, { error: "unauthorized" })).fetch });
    expect(await api.sync(TOKEN, syncReq)).toEqual({ ok: false, error: { kind: "unauthorized" } });
  });

  test("429 honours Retry-After (seconds and HTTP date)", async () => {
    const secs = createApiClient({
      baseUrl: "https://x.dev",
      fetch: fakeFetch(() => json(429, {}, { "Retry-After": "30" })).fetch,
    });
    expect(await secs.sync(TOKEN, syncReq)).toEqual({ ok: false, error: { kind: "rate_limited", retryAfterMs: 30_000 } });
    expect(parseRetryAfter(new Date(NOW + 120_000).toUTCString(), NOW)).toBe(120_000);
    expect(parseRetryAfter(null, NOW)).toBe(60_000);
    expect(parseRetryAfter("999999", NOW)).toBe(3_600_000);
    expect(parseRetryAfter("0", NOW)).toBe(1_000);
  });

  test("network failures and 5xx", async () => {
    const down = createApiClient({
      baseUrl: "https://x.dev",
      fetch: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    expect(await down.sync(TOKEN, syncReq)).toEqual({ ok: false, error: { kind: "network" } });
    const boom = createApiClient({ baseUrl: "https://x.dev", fetch: fakeFetch(() => new Response("oops", { status: 503 })).fetch });
    expect(await boom.sync(TOKEN, syncReq)).toEqual({ ok: false, error: { kind: "server", status: 503 } });
  });

  test("validates sync responses strictly", async () => {
    const api = (body: unknown) =>
      createApiClient({ baseUrl: "https://x.dev", fetch: fakeFetch(() => json(200, body)).fetch, now: () => NOW });
    expect((await api("not json at all").sync(TOKEN, syncReq)).ok).toBe(false);
    expect((await api(page({ cursor: 42 })).sync(TOKEN, syncReq)).ok).toBe(false);
    const evil = toSyncChanges(makeData());
    evil.habits[0]!.name = "x".repeat(500);
    expect((await api(page({ changes: evil })).sync(TOKEN, syncReq)).ok).toBe(false);
    // Far-future timestamps would win every merge forever.
    const future = toSyncChanges(makeData());
    future.arcs[0]!.updatedAt = "2030-01-01T00:00:00.000Z";
    expect((await api(page({ changes: future })).sync(TOKEN, syncReq)).ok).toBe(false);
    // Pages larger than the per-request limits still validate (chunked).
    const big = toSyncChanges(makeData({ now: T0 }));
    const habitId = big.habits[0]!.id;
    big.checkIns = Array.from({ length: 6000 }, (_, i) => ({
      habitId,
      date: `2026-${String(10 + (i % 3)).padStart(2, "0")}-01`,
      done: true,
      updatedAt: T0,
    }));
    const r = await api(page({ changes: big, hasMore: true })).sync(TOKEN, syncReq);
    expect(r.ok && r.value.changes.checkIns.length).toBe(6000);
    expect(r.ok && r.value.hasMore).toBe(true);
  });
});

describe("API error codes", () => {
  const api = (res: () => Response) => {
    const f = fakeFetch(res);
    return { api: createApiClient({ baseUrl: "https://x.dev", fetch: f.fetch }), calls: f.calls };
  };
  test("maps the documented codes", async () => {
    expect(await api(() => json(400, { error: "invalid_cursor" })).api.sync(TOKEN, syncReq)).toEqual({
      ok: false,
      error: { kind: "invalid_cursor" },
    });
    expect(await api(() => json(422, { error: "quota_exceeded" })).api.sync(TOKEN, syncReq)).toEqual({
      ok: false,
      error: { kind: "quota_exceeded" },
    });
    expect(await api(() => json(400, { error: "invalid_email" })).api.requestMagicLink("x", "en")).toEqual({
      ok: false,
      error: { kind: "invalid_email" },
    });
    expect(await api(() => json(415, { error: "unsupported_media_type" })).api.sync(TOKEN, syncReq)).toEqual({
      ok: false,
      error: { kind: "bad_request" },
    });
  });

  test("logout and delete send JSON / handle 204", async () => {
    const { api: a, calls } = api(() => new Response(null, { status: 204 }));
    expect(await a.logout(TOKEN)).toEqual({ ok: true, value: undefined });
    expect((calls[0]!.init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(calls[0]!.init.body).toBe("{}");
    expect(await a.deleteAccount(TOKEN)).toEqual({ ok: true, value: undefined });
    expect(calls[1]!.init.method).toBe("DELETE");
    expect(calls[1]!.url).toBe("https://x.dev/v1/me");
  });
});

describe("stricter contract codes", () => {
  test("invalid_request", async () => {
    const mk = (res: () => Response) => createApiClient({ baseUrl: "https://x.dev", fetch: fakeFetch(res).fetch });
    expect(await mk(() => json(400, { error: "invalid_request", detail: "changes.habits[0].emoji" })).sync(TOKEN, syncReq)).toEqual({
      ok: false,
      error: { kind: "invalid_request" },
    });
  });
});
