import { describe, expect, test } from "bun:test";

import { jobApiRoot, jobPathFromFullName } from "./jenkins-api.ts";

describe("jenkins-api", () => {
  test("jobPathFromFullName encodes each path segment", () => {
    expect(jobPathFromFullName("my-job")).toBe("my-job");
    expect(jobPathFromFullName("folder/sub")).toBe("folder/job/sub");
  });

  test("jobApiRoot builds classic path", () => {
    expect(jobApiRoot("https://ci.example", "a/b")).toBe("https://ci.example/job/a/job/b");
  });
});
