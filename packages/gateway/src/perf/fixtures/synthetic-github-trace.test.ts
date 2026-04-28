import { describe, expect, test } from "bun:test";
import {
  buildGithubLinkHeader,
  GITHUB_TIER_COUNTS,
  githubPullsPages,
} from "./synthetic-github-trace.ts";

describe("githubPullsPages", () => {
  test("small tier produces the expected total PR count", () => {
    const pages = githubPullsPages("small");
    const total = pages.reduce((s, p) => s + p.length, 0);
    expect(total).toBe(GITHUB_TIER_COUNTS.small);
  });

  test("each PR has number / title / state / updated_at", () => {
    const pr = githubPullsPages("small")[0]?.[0];
    expect(typeof pr?.number).toBe("number");
    expect(typeof pr?.title).toBe("string");
    expect(["open", "closed"]).toContain(pr?.state);
    expect(typeof pr?.updated_at).toBe("string");
  });

  test("deterministic", () => {
    const a = JSON.stringify(githubPullsPages("small"));
    const b = JSON.stringify(githubPullsPages("small"));
    expect(a).toBe(b);
  });
});

describe("buildGithubLinkHeader", () => {
  test("first page only has next/last", () => {
    const h = buildGithubLinkHeader({ page: 1, totalPages: 5, perPage: 100 });
    expect(h).toContain('rel="next"');
    expect(h).toContain('rel="last"');
    expect(h).not.toContain('rel="prev"');
  });
  test("middle page has prev/next/last/first", () => {
    const h = buildGithubLinkHeader({ page: 3, totalPages: 5, perPage: 100 });
    expect(h).toContain('rel="prev"');
    expect(h).toContain('rel="next"');
    expect(h).toContain('rel="first"');
    expect(h).toContain('rel="last"');
  });
  test("last page has prev/first only", () => {
    const h = buildGithubLinkHeader({ page: 5, totalPages: 5, perPage: 100 });
    expect(h).toContain('rel="prev"');
    expect(h).not.toContain('rel="next"');
  });
});
