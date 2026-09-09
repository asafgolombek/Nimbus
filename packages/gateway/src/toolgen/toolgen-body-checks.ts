import { ToolgenError } from "./toolgen-types.ts";

/**
 * The AsyncFunction constructor.
 *
 * `new Function` builds a SYNCHRONOUS function, so `await nimbusFetch(...)` — which every useful
 * generated body contains — throws `SyntaxError` before any real defect is reached. A rung that
 * fails 100% of correct inputs is not strict, it is broken. Verified on Bun; see spec § 4.2 rung 3.
 */
const AsyncFunction = Object.getPrototypeOf(async () => {
  /* probe */
}).constructor as new (
  ...args: string[]
) => unknown;

/**
 * Rung 3: does the model-authored body PARSE?
 *
 * This is the only place in the gateway that constructs a function from model output. It COMPILES
 * and never invokes: the constructed value is discarded unread and only the throw/no-throw is
 * used. Do not add a call, and do not return the function — a second call site here is what would
 * earn this a static rule (spec § 10).
 */
export function verifyBodySyntax(body: string): void {
  try {
    new AsyncFunction("args", body);
  } catch (err) {
    throw new ToolgenError(
      "ERR_TOOLGEN_DRAFT_SYNTAX",
      `tool body does not parse: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Rung 4: reject constructs the sandbox would refuse anyway.
 *
 * NOT A SECURITY BOUNDARY. The sandbox is: `permissions.network` is `[]` by construction, so a raw
 * `fetch()` fails at the OS on all three platforms, and the emitted skeleton makes no
 * `require`/`import` available regardless. This exists so the owner is never asked to approve a
 * body that provably cannot work. Describing it as a defense would be the shape recorded in
 * `airgap-was-inert-while-docs-promised-it`.
 *
 * Matched on word boundaries, never by substring: `prefetch(` and `client.fetch(` both CONTAIN
 * `fetch(` and are legitimate.
 */
const FORBIDDEN: ReadonlyArray<{ readonly re: RegExp; readonly what: string }> = [
  { re: /(?<![\w$.])fetch\s*\(/, what: "the global fetch()" },
  { re: /(?<![\w$.])require\s*\(/, what: "require()" },
  { re: /(?<![\w$.])eval\s*\(/, what: "eval()" },
  { re: /(?<![\w$.])process\s*\./, what: "process" },
  { re: /(?<![\w$.])Bun\s*\./, what: "Bun" },
  { re: /(?<![\w$.])import\s*[\s(]/, what: "an import" },
];

export function scanBodyForForbiddenGlobals(body: string): void {
  for (const { re, what } of FORBIDDEN) {
    if (re.test(body)) {
      throw new ToolgenError(
        "ERR_TOOLGEN_DRAFT_FORBIDDEN",
        `tool body uses ${what}, which is unavailable in the sandbox — use nimbusFetch(url, init) for network access and standard ECMAScript globals for everything else`,
      );
    }
  }
}
