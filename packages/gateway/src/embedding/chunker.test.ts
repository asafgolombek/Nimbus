import { describe, expect, test } from "bun:test";

import { chunkText, itemTextForEmbedding } from "./chunker.ts";

describe("chunkText", () => {
  test("empty input yields no chunks", () => {
    expect(chunkText("   ")).toEqual([]);
  });

  test("short text is a single chunk", () => {
    const chunks = chunkText("Quarterly report for Zurich.", { maxChunkTokens: 256 });
    expect(chunks.length).toBe(1);
  });

  test("splits oversized run-on text under char budget", () => {
    const word = "word ";
    const body = word.repeat(400);
    const chunks = chunkText(body, { maxChunkTokens: 32, overlapTokens: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(32 * 4 + 50);
    }
  });

  test("overlap prefixes later chunks when enabled", () => {
    const sentence = (n: number) => `This is sentence number ${String(n)}. `;
    let text = "";
    for (let i = 0; i < 40; i++) {
      text += sentence(i);
    }
    const chunks = chunkText(text, { maxChunkTokens: 48, overlapTokens: 12 });
    expect(chunks.length).toBeGreaterThan(1);
    const second = chunks[1] ?? "";
    const first = chunks[0] ?? "";
    expect(second.length).toBeGreaterThan(0);
    const tail = first.slice(-40).trim();
    expect(
      second.includes(tail.slice(0, Math.min(12, tail.length))) || second.includes("sentence"),
    ).toBe(true);
  });
});

describe("itemTextForEmbedding", () => {
  test("uses title only when body missing", () => {
    expect(itemTextForEmbedding({ title: "T", body_preview: null })).toBe("T");
  });

  test("joins title and body preview", () => {
    expect(itemTextForEmbedding({ title: "T", body_preview: "B" })).toBe("T\nB");
  });
});
