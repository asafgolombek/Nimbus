import { describe, expect, test } from "bun:test";
import type { RankedIndexItem } from "../index/ranked-item.ts";
import { createEndpointFinder, groundingOf } from "./toolgen-grounding.ts";

function rankedItem(title: string, meta: Record<string, unknown>): RankedIndexItem {
  return {
    id: title,
    service: "openapi",
    itemType: "api_endpoint",
    name: title,
    rawMeta: meta,
    score: 1,
    indexPrimaryKey: title,
    indexedType: "api_endpoint",
  } as unknown as RankedIndexItem;
}

describe("createEndpointFinder", () => {
  test("queries api_endpoint items with the description as the search term", async () => {
    const calls: unknown[] = [];
    const index = {
      searchRankedAsync: async (q: unknown) => {
        calls.push(q);
        return [
          rankedItem("GET /repos/{owner}/{repo}/issues", {
            service_name: "github-api",
            operation_id: "listIssues",
            tags: ["issues"],
          }),
        ];
      },
    };
    const find = createEndpointFinder(index as never);
    const out = await find("list issues in a repo", 8);

    expect(calls[0]).toEqual({ itemType: "api_endpoint", name: "list issues in a repo", limit: 8 });
    expect(out).toEqual([
      {
        serviceName: "github-api",
        method: "GET",
        path: "/repos/{owner}/{repo}/issues",
        operationId: "listIssues",
        summary: "issues",
      },
    ]);
  });

  test("skips an item whose title is not METHOD PATH rather than emitting a broken row", async () => {
    const index = { searchRankedAsync: async () => [rankedItem("malformed", {})] };
    expect(await createEndpointFinder(index as never)("q", 8)).toEqual([]);
  });

  test("AsyncAPI channels are deliberately excluded: a generated tool has no pub/sub transport", async () => {
    const index = {
      searchRankedAsync: async () => [
        rankedItem("PUBLISH user/signedup", { service_name: "kafka", tags: ["user"] }),
        rankedItem("SUBSCRIBE user/signedup", { service_name: "kafka", tags: ["user"] }),
      ],
    };
    expect(await createEndpointFinder(index as never)("q", 8)).toEqual([]);
  });

  test("an index error yields no grounding rather than failing the draft", async () => {
    const index = {
      searchRankedAsync: async () => {
        throw new Error("index unavailable");
      },
    };
    expect(await createEndpointFinder(index as never)("q", 8)).toEqual([]);
  });
});

describe("groundingOf", () => {
  test("reports description_only for an empty result", () => {
    expect(groundingOf([])).toEqual({ kind: "description_only" });
  });

  test("reports a count and DEDUPLICATED service names", () => {
    const ep = (serviceName: string) => ({
      serviceName,
      method: "GET",
      path: "/x",
      operationId: null,
      summary: "",
    });
    expect(groundingOf([ep("a"), ep("a"), ep("b")])).toEqual({
      kind: "endpoints",
      count: 3,
      services: ["a", "b"],
    });
  });
});
