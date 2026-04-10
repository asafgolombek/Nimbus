import { describe, expect, test } from "bun:test";

import {
  collapseWhitespace,
  plainTextPreviewFromHtml,
  stripHtmlTagsToSpaces,
} from "./html-plain-text.ts";

describe("stripHtmlTagsToSpaces", () => {
  test("removes paired tags and inserts spaces", () => {
    expect(stripHtmlTagsToSpaces("a<b>c</b>d")).toBe("a c d");
  });

  test("treats unclosed < as hiding the remainder", () => {
    expect(stripHtmlTagsToSpaces("ab<cd")).toBe("ab");
  });

  test("empty and no tags", () => {
    expect(stripHtmlTagsToSpaces("")).toBe("");
    expect(stripHtmlTagsToSpaces("plain")).toBe("plain");
  });
});

describe("collapseWhitespace", () => {
  test("collapses runs and trims", () => {
    expect(collapseWhitespace("  a  \n\t b  ")).toBe("a b");
  });
});

describe("plainTextPreviewFromHtml", () => {
  test("strips tags, collapses space, respects maxLen", () => {
    expect(plainTextPreviewFromHtml("<p>hello</p> world", 20)).toBe("hello world");
    expect(plainTextPreviewFromHtml("abcdefghijklmnop", 4)).toBe("abcd");
  });
});
