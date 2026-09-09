import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { CURRENT_SCHEMA_VERSION } from "../index/local-index.ts";
import { runIndexedSchemaMigrations } from "../index/migrations/runner.ts";
import { ToolgenBroker } from "./toolgen-broker.ts";
import { ToolgenError } from "./toolgen-types.ts";

function deps(over: Partial<ConstructorParameters<typeof ToolgenBroker>[0]> = {}) {
  const db = new Database(":memory:");
  runIndexedSchemaMigrations(db, CURRENT_SCHEMA_VERSION);
  return {
    db,
    now: () => 1,
    maxRequestsPerTool: 50,
    requestTimeoutMs: 1000,
    resolveHost: async () => ["93.184.216.34"],
    readCredential: async () => null,
    approvedHostsFor: () => ["api.example.com"],
    doFetch: async () => new Response("ok", { status: 200 }),
    ...over,
  };
}

function rows(db: Database): { destination: string; result_status: string }[] {
  return db
    .query<{ destination: string; result_status: string }, []>(
      "SELECT destination, result_status FROM egress_ledger WHERE source_type = 'tool'",
    )
    .all();
}

describe("ToolgenBroker.handleFetch", () => {
  test("an approved host is fetched and appends ONE authorized row", async () => {
    const d = deps();
    const res = await new ToolgenBroker(d).handleFetch("tg_a", {
      url: "https://api.example.com/v1",
    });
    expect(res.status).toBe(200);
    expect(rows(d.db)).toEqual([{ destination: "api.example.com", result_status: "authorized" }]);
  });

  test("a host OUTSIDE the envelope is refused and appends a blocked row", async () => {
    const d = deps();
    await expect(
      new ToolgenBroker(d).handleFetch("tg_a", { url: "https://evil.example.com/v1" }),
    ).rejects.toThrow(ToolgenError);
    expect(rows(d.db)).toEqual([{ destination: "evil.example.com", result_status: "blocked" }]);
  });

  test("an approved host that RESOLVES to loopback is refused — the check is on the address", async () => {
    const d = deps({ resolveHost: async () => ["127.0.0.1"] });
    await expect(
      new ToolgenBroker(d).handleFetch("tg_a", { url: "https://api.example.com/v1" }),
    ).rejects.toMatchObject({ code: "ERR_TOOLGEN_HOST_NOT_ALLOWED" });
    expect(rows(d.db)[0]?.result_status).toBe("blocked");
  });

  test("a host resolving to a mix of public and forbidden addresses is refused — one bad record among good ones is enough", async () => {
    const d = deps({ resolveHost: async () => ["93.184.216.34", "127.0.0.1"] });
    await expect(
      new ToolgenBroker(d).handleFetch("tg_a", { url: "https://api.example.com/v1" }),
    ).rejects.toMatchObject({ code: "ERR_TOOLGEN_HOST_NOT_ALLOWED" });
    expect(rows(d.db)).toEqual([{ destination: "api.example.com", result_status: "blocked" }]);
  });

  test("a host resolving to no addresses at all is refused", async () => {
    const d = deps({ resolveHost: async () => [] });
    await expect(
      new ToolgenBroker(d).handleFetch("tg_a", { url: "https://api.example.com/v1" }),
    ).rejects.toMatchObject({ code: "ERR_TOOLGEN_HOST_NOT_ALLOWED" });
    expect(rows(d.db)).toEqual([{ destination: "api.example.com", result_status: "blocked" }]);
  });

  test("an egress append FAILURE aborts the request — fail-closed, no fetch", async () => {
    let fetched = false;
    const d = deps({
      doFetch: async () => {
        fetched = true;
        return new Response("ok");
      },
    });
    d.db.close(); // any append now throws
    await expect(
      new ToolgenBroker(d).handleFetch("tg_a", { url: "https://api.example.com/v1" }),
    ).rejects.toThrow();
    expect(fetched).toBe(false);
  });

  test("a tool-supplied Authorization header is STRIPPED", async () => {
    let seen: Headers | undefined;
    const d = deps({
      doFetch: async (_u: string, init: RequestInit) => {
        seen = new Headers(init.headers);
        return new Response("ok");
      },
    });
    await new ToolgenBroker(d).handleFetch("tg_a", {
      url: "https://api.example.com/v1",
      headers: { Authorization: "Bearer stolen" },
    });
    expect(seen?.get("authorization")).toBeNull();
  });

  test("the credential bound to host A is NOT attached to host B", async () => {
    let seen: Headers | undefined;
    const d = deps({
      approvedHostsFor: () => ["a.example.com", "b.example.com"],
      readCredential: async (_t: string, host: string) =>
        host === "a.example.com" ? { type: "bearer" as const, token: "A-ONLY" } : null,
      doFetch: async (_u: string, init: RequestInit) => {
        seen = new Headers(init.headers);
        return new Response("ok");
      },
    });
    await new ToolgenBroker(d).handleFetch("tg_a", { url: "https://b.example.com/v1" });
    expect(seen?.get("authorization")).toBeNull();
  });

  test("the per-tool request budget is enforced and the refusal is ledgered", async () => {
    const d = deps({ maxRequestsPerTool: 1 });
    const b = new ToolgenBroker(d);
    await b.handleFetch("tg_a", { url: "https://api.example.com/1" });
    await expect(b.handleFetch("tg_a", { url: "https://api.example.com/2" })).rejects.toMatchObject(
      { code: "ERR_TOOLGEN_BUDGET_EXHAUSTED" },
    );
    expect(rows(d.db).map((r) => r.result_status)).toEqual(["authorized", "blocked"]);
  });

  test("a response past the cap is refused rather than buffered", async () => {
    const big = "x".repeat(6 * 1024 * 1024);
    const d = deps({ doFetch: async () => new Response(big) });
    await expect(
      new ToolgenBroker(d).handleFetch("tg_a", { url: "https://api.example.com/v1" }),
    ).rejects.toMatchObject({ code: "ERR_TOOLGEN_RESPONSE_TOO_LARGE" });
  });

  test("a DNS failure is REFUSED and still appends a blocked row", async () => {
    const d = deps({
      resolveHost: async () => {
        throw new Error("ENOTFOUND");
      },
    });
    await expect(
      new ToolgenBroker(d).handleFetch("tg_a", { url: "https://api.example.com/v1" }),
    ).rejects.toThrow(ToolgenError);
    expect(rows(d.db)).toEqual([{ destination: "api.example.com", result_status: "blocked" }]);
  });

  test("a malformed params object is refused without a fetch", async () => {
    const d = deps();
    await expect(new ToolgenBroker(d).handleFetch("tg_a", { url: 42 })).rejects.toThrow(
      ToolgenError,
    );
  });

  test("a syntactically invalid URL is refused without appending a row", async () => {
    const d = deps();
    await expect(
      new ToolgenBroker(d).handleFetch("tg_a", { url: "not a url" }),
    ).rejects.toMatchObject({ code: "ERR_TOOLGEN_BAD_REQUEST" });
    expect(rows(d.db)).toEqual([]);
  });
});
