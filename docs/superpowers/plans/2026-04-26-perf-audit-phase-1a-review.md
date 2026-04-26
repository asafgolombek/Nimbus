# Review: Perf Audit (B2) — Phase 1A Implementation Plan

## 📝 Overview
This plan outlines the first phase of the performance audit (B2), focusing on building the core harness, fixtures, and the S2-a query latency driver. It introduces a new `perf` package within the gateway and wires a new `nimbus bench` CLI command. The plan is technically thorough, well-sequeded, and aligns closely with the approved design specification.

## ❓ Open Questions
- **[Architecture Integrity]**: The `nimbus bench` CLI command in `packages/cli` imports source code from `packages/gateway/src/perf/index.ts`. This violates the standard "IPC-only" dependency rule for the CLI. Is this an intentional exception for the benching harness to ensure in-process measurement accuracy?
- **[CLI Registry]**: Task 9 Step 4 suggests importing `runBench` directly into `packages/cli/src/index.ts`. Is there a reason to bypass the central command registry in `packages/cli/src/commands/index.ts`?

## 💡 Suggestions
- **[Process Exit]**: In Task 9 Step 4, replace `process.exit(await runBench(args))` with `process.exitCode = await runBench(args)`. This allows the `main()` function to reach the `outro("Done.")` call and perform any final logging/cleanup before the process naturally terminates.
- **[Run ID Persistence]**: Generate the `runId` (UUID) at the start of `runBench` (the CLI command) or `runBenchCli` (the orchestrator) and pass it into both the orchestrator and the signal handler context factory. This ensures that an interrupted run is recorded in `history.jsonl` with the same `runId` that was intended for that execution, rather than a generic `"interrupted"` string.

## 🚀 Improvements
- **[CLI Import Pattern]**: Follow the established project pattern by adding `export { runBench } from "./bench.ts";` to `packages/cli/src/commands/index.ts` and then importing it into `packages/cli/src/index.ts` alongside other commands.
- **[Harness Error Context]**: In Task 4 (`bench-harness.ts`), when a surface function fails, the error message includes the surface ID and run index. Consider also logging the surface-specific error details to `stderr` within the loop to assist with debugging when `runs > 1`.

## 🧐 Explanations & Rationale
- **[Dependency Rules]**: Nimbus standards (Rule 6) mandate that the CLI communicates with the gateway exclusively via IPC. Benching often requires in-process execution to eliminate IPC noise. If this exception is granted, it should ideally be documented in the code or `GEMINI.md` to prevent similar patterns from leaking into user-facing commands.
- **[CLI Consistency]**: The central dispatcher in `packages/cli/src/index.ts` is designed for high-level routing. Keeping the specific command logic and imports in `packages/cli/src/commands/` preserves the maintainability of the CLI package.
- **[Graceful Termination]**: The CLI uses `@clack/prompts` for UI. Bypassing the `outro` call by using `process.exit` can lead to a jarring terminal experience where the final "Done" message and standard footer are missing.
