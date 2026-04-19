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

  const peerCommands = [
    { sub: "grant", peerId: "abc-123" },
    { sub: "revoke", peerId: "peer-x" },
    { sub: "remove", peerId: "peer-y" },
  ] as const;

  for (const { sub, peerId } of peerCommands) {
    test(`${sub} <peerId>`, () => {
      expect(parseLanArgs([sub, peerId])).toEqual({ kind: sub, peerId });
    });

    test(`${sub} missing peerId throws`, () => {
      expect(() => parseLanArgs([sub])).toThrow(new RegExp(`Usage: nimbus lan ${sub}`));
    });
  }

  test("grant trims whitespace from peerId", () => {
    expect(parseLanArgs(["grant", "  trimmed  "])).toEqual({ kind: "grant", peerId: "trimmed" });
  });

  test("unknown subcommand throws", () => {
    expect(() => parseLanArgs(["bogus"])).toThrow(/Unknown subcommand/);
  });
});
