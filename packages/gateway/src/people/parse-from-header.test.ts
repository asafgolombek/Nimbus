import { expect, test } from "bun:test";

import { parseFromHeaderForPerson } from "./parse-from-header.ts";

test("parseFromHeaderForPerson: named angle address", () => {
  const r = parseFromHeaderForPerson(`Jane Doe <Jane.Doe@Example.COM>`);
  expect(r.email).toBe("jane.doe@example.com");
  expect(r.displayName).toBe("Jane Doe");
});

test("parseFromHeaderForPerson: bare email", () => {
  const r = parseFromHeaderForPerson("a@b.co");
  expect(r.email).toBe("a@b.co");
  expect(r.displayName).toBe("a@b.co");
});

test("parseFromHeaderForPerson: empty", () => {
  expect(parseFromHeaderForPerson(null)).toEqual({});
  expect(parseFromHeaderForPerson("   ")).toEqual({});
});
