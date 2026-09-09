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
