/**
 * Nimbus CLI — `nimbus <command> [options]`
 *
 * Communicates with the Gateway over JSON-RPC IPC only.
 */

import { intro, outro } from "@clack/prompts";

import {
  printHelp,
  runAsk,
  runAudit,
  runBench,
  runConfig,
  runConnector,
  runData,
  runDb,
  runDiag,
  runDoctor,
  runExtension,
  runLan,
  runPeople,
  runProfile,
  runQuery,
  runRepl,
  runScaffold,
  runSearch,
  runServe,
  runSession,
  runStart,
  runStatus,
  runStop,
  runTelemetry,
  runTest,
  runTui,
  runUpdate,
  runVault,
  runWatch,
  runWorkflowCli,
  runWorkflowFromFile,
} from "./commands/index.ts";
import { createCliFileLogger } from "./lib/cli-logger.ts";
import { getCliPlatformPaths } from "./paths.ts";

const rawArgv = process.argv.slice(2);
const isInteractiveShell = process.stdin.isTTY === true && process.stdout.isTTY === true;

type CommandHandler = (args: string[]) => Promise<void> | void;

const COMMAND_HANDLERS: Readonly<Record<string, CommandHandler>> = {
  start: runStart,
  stop: runStop,
  status: runStatus,
  db: runDb,
  diag: runDiag,
  query: runQuery,
  telemetry: runTelemetry,
  tui: runTui,
  update: runUpdate,
  doctor: runDoctor,
  config: runConfig,
  profile: runProfile,
  serve: runServe,
  test: runTest,
  ask: runAsk,
  vault: runVault,
  audit: runAudit,
  connector: runConnector,
  data: runData,
  extension: runExtension,
  people: runPeople,
  search: runSearch,
  session: runSession,
  workflow: runWorkflowCli,
  watch: runWatch,
  repl: runRepl,
  run: runWorkflowFromFile,
  scaffold: runScaffold,
  lan: runLan,
};

const HELP_ALIASES = new Set(["help", "--help", "-h"]);

async function dispatchCommand(command: string, args: string[]): Promise<void> {
  if (HELP_ALIASES.has(command)) {
    printHelp();
    return;
  }
  if (command === "bench") {
    process.exitCode = await runBench(args);
    return;
  }
  const handler = COMMAND_HANDLERS[command];
  if (handler === undefined) {
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exitCode = 1;
    return;
  }
  await handler(args);
}

async function main(): Promise<void> {
  intro("Nimbus");
  const paths = getCliPlatformPaths();
  const { logger } = await createCliFileLogger(paths);
  logger.info({ event: "cli.invoke", argv: process.argv }, "invoke");

  try {
    if (rawArgv.length === 0 && isInteractiveShell) {
      await runRepl([]);
    } else {
      const [command = "help", ...args] = rawArgv;
      await dispatchCommand(command, args);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error(
      {
        event: "cli.error",
        err:
          e instanceof Error
            ? { type: e.name, message: e.message, stack: e.stack }
            : { message: String(e) },
      },
      msg,
    );
    console.error(msg);
    process.exitCode = 1;
  } finally {
    logger.info({ event: "cli.finished", exitCode: process.exitCode ?? 0 }, "finished");
  }

  outro("Done.");
}

await main();
