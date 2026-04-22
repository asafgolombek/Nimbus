// Vitest global test setup for the Nimbus UI package
// Runs before each test file via vitest.config.ts setupFiles

import "@testing-library/jest-dom";
import { vi } from "vitest";

// @testing-library/dom v10 checks `typeof jest !== 'undefined'` to detect fake timers.
// Vitest 4.x does not inject a `jest` global, so waitFor() hangs when vi.useFakeTimers()
// is active. Aliasing `jest` to `vi` restores the expected behaviour.
// See: https://github.com/testing-library/dom-testing-library/issues/987
// biome-ignore lint/suspicious/noExplicitAny: jest compat shim requires any
(globalThis as unknown as Record<string, unknown>).jest = vi as unknown as any;
