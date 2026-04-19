import { describe, expect, test } from "bun:test";
import { parseLanArgs } from "./lan.ts";

describe("parseLanArgs", () => {
  test("no args → status", () => {
    expect(parseLanArgs([])).toEqual({ kind: "status" });
  });

  test("status → status", () => {
    expect(parseLanArgs(["status"])).toEqual({ kind: "status" });
  });

  test("open → open", () => {
    expect(parseLanArgs(["open"])).toEqual({ kind: "open" });
  });

  test("close → close", () => {
    expect(parseLanArgs(["close"])).toEqual({ kind: "close" });
  });

  test("peers → peers", () => {
    expect(parseLanArgs(["peers"])).toEqual({ kind: "peers" });
  });

  test("grant <peerId>", () => {
    expect(parseLanArgs(["grant", "abc-123"])).toEqual({ kind: "grant", peerId: "abc-123" });
  });

  test("grant missing peerId throws", () => {
    expect(() => parseLanArgs(["grant"])).toThrow(/Usage: nimbus lan grant/);
  });

  test("revoke <peerId>", () => {
    expect(parseLanArgs(["revoke", "peer-x"])).toEqual({ kind: "revoke", peerId: "peer-x" });
  });

  test("revoke missing peerId throws", () => {
    expect(() => parseLanArgs(["revoke"])).toThrow(/Usage: nimbus lan revoke/);
  });

  test("remove <peerId>", () => {
    expect(parseLanArgs(["remove", "peer-y"])).toEqual({ kind: "remove", peerId: "peer-y" });
  });

  test("remove missing peerId throws", () => {
    expect(() => parseLanArgs(["remove"])).toThrow(/Usage: nimbus lan remove/);
  });

  test("unknown subcommand throws", () => {
    expect(() => parseLanArgs(["bogus"])).toThrow(/Unknown subcommand/);
  });

  test("grant trims whitespace from peerId", () => {
    expect(parseLanArgs(["grant", "  trimmed  "])).toEqual({ kind: "grant", peerId: "trimmed" });
  });
});
