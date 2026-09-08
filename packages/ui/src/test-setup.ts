// `/vitest`, not the bare entry. The bare entry's types are `/// <reference path="jest.d.ts" />`,
// which augments the JEST global namespace; only this entry carries `declare module 'vitest'` and
// extends vitest's own `Assertion`. Under vitest 4 the bare import happened to satisfy the matcher
// types anyway; vitest 5 inlined the `expect` package (vitest-dev/vitest#10221), which changed
// which interface the augmentation has to land on, and every `toBeInTheDocument` / `toBeDisabled`
// call became TS2339.
import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// biome-ignore lint/suspicious/noExplicitAny: jest compat shim requires any
(globalThis as unknown as Record<string, unknown>).jest = vi as unknown as any;
