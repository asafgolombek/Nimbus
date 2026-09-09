import { describe, expect, test } from "bun:test";
import {
  assertAllowedScheme,
  isForbiddenAddress,
  STRIPPED_REQUEST_HEADERS,
} from "./toolgen-address-guard.ts";
import { ToolgenError } from "./toolgen-types.ts";

describe("isForbiddenAddress", () => {
  test.each([
    ["127.0.0.1", "IPv4 loopback — the Gateway's own IPC socket and HTTP API"],
    ["127.1.2.3", "the rest of 127/8, which also routes to loopback"],
    ["0.0.0.0", "unspecified, which resolves to local on several stacks"],
    ["10.1.2.3", "RFC 1918"],
    ["172.16.0.1", "RFC 1918"],
    ["172.31.255.254", "RFC 1918 upper bound"],
    ["192.168.1.1", "RFC 1918"],
    ["169.254.1.1", "link-local"],
    ["169.254.169.254", "cloud metadata"],
    ["::", "IPv6 unspecified"],
    ["::1", "IPv6 loopback"],
    ["0:0:0:0:0:0:0:1", "IPv6 loopback (uncompressed)"],
    ["fe80::1", "IPv6 link-local"],
    ["fea0::1", "IPv6 link-local (fe80::/10 coverage)"],
    ["febf::1", "IPv6 link-local upper bound (fe80::/10 coverage)"],
    ["fc00::1", "IPv6 unique-local"],
    ["fd12:3456::1", "IPv6 unique-local (fc00::/7 coverage)"],
    ["::ffff:127.0.0.1", "IPv6 IPv4-mapped loopback"],
    ["::ffff:7f00:1", "IPv6 IPv4-mapped loopback (hex form)"],
    ["::ffff:10.0.0.1", "IPv6 IPv4-mapped RFC 1918"],
    ["::127.0.0.1", "IPv6 IPv4-compatible loopback"],
  ])("refuses %s (%s)", (ip) => {
    expect(isForbiddenAddress(ip)).toBe(true);
  });

  test.each([
    ["93.184.216.34"],
    ["8.8.8.8"],
    ["172.32.0.1"],
    ["2606:2800:220:1::1"],
    ["fec0::1"],
    ["::ffff:8.8.8.8"],
    ["not-an-ip"],
    ["fe80::1::2"],
  ])("allows public address %s", (ip) => {
    expect(isForbiddenAddress(ip)).toBe(false);
  });

  test("172.32.0.0 is NOT private — the RFC 1918 block ends at 172.31", () => {
    expect(isForbiddenAddress("172.15.255.255")).toBe(false);
    expect(isForbiddenAddress("172.32.0.0")).toBe(false);
  });
});

describe("assertAllowedScheme", () => {
  test("https is allowed", () => {
    expect(() => assertAllowedScheme(new URL("https://api.example.com/x"))).not.toThrow();
  });

  test.each([
    ["http://a.example.com"],
    ["file:///etc/passwd"],
    ["data:text/plain,hi"],
    ["gopher://a.example.com"],
  ])("refuses %s", (raw) => {
    expect(() => assertAllowedScheme(new URL(raw))).toThrow(ToolgenError);
  });
});

describe("STRIPPED_REQUEST_HEADERS", () => {
  test("auth headers a tool supplies are dropped, matched case-insensitively", () => {
    expect(STRIPPED_REQUEST_HEADERS.has("authorization")).toBe(true);
    expect(STRIPPED_REQUEST_HEADERS.has("proxy-authorization")).toBe(true);
    expect(STRIPPED_REQUEST_HEADERS.has("cookie")).toBe(true);
  });
});
describe("NAT64 translation is seen through to the address a caller actually reaches", () => {
  // The prefix `64:ff9b::/96` is itself public and routable, so every check upstream of this one
  // reports such a destination as fine. Before this branch existed, an approved hostname resolving
  // into the prefix reached loopback, RFC 1918 and the cloud metadata endpoint through a
  // translating gateway -- the exact class I39's address check exists to stop.
  test.each([
    ["loopback", "64:ff9b::7f00:1"],
    ["loopback, dotted tail", "64:ff9b::127.0.0.1"],
    ["RFC 1918 10/8", "64:ff9b::a00:1"],
    ["RFC 1918 192.168/16", "64:ff9b::c0a8:1"],
    ["link-local", "64:ff9b::a9fe:1"],
    ["cloud metadata 169.254.169.254", "64:ff9b::a9fe:a9fe"],
  ])("%s embedded in the NAT64 well-known prefix is forbidden", (_label, addr) => {
    expect(isForbiddenAddress(addr)).toBe(true);
  });

  test("a NAT64-wrapped PUBLIC address stays allowed -- the embedded address is judged, not the prefix", () => {
    // 5db8:d822 is 93.184.216.34. Blanket-blocking the prefix would be the lazy fix and would
    // break every legitimate IPv6-only host behind a NAT64 gateway.
    expect(isForbiddenAddress("64:ff9b::5db8:d822")).toBe(false);
  });

  test("the prefix is matched exactly -- a lookalike that merely starts with 64: is not treated as NAT64", () => {
    // 64:ff9c is NOT the well-known prefix, so its low bits are not an embedded IPv4 and must not
    // be reinterpreted as one. It is an ordinary public address.
    expect(isForbiddenAddress("64:ff9c::7f00:1")).toBe(false);
    expect(isForbiddenAddress("0064:ff9b:1::7f00:1")).toBe(false);
  });
});
