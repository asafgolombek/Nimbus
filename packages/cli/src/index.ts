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
  runConfig,
  runConnector,
  runData,
  runDb,
  runDiag,
  runDoctor,
  runExtension,
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
  runVault,
  runWatch,
  runWorkflowCli,
  runWorkflowFromFile,
} from "./commands/index.ts";
import { createCliFileLogger } from "./lib/cli-logger.ts";
import { getCliPlatformPaths } from "./paths.ts";

const rawArgv = process.argv.slice(2);
const isInteractiveShell = process.stdin.isTTY === true && process.stdout.isTTY === true;

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
      switch (command) {
        case "help":
        case "--help":
        case "-h":
          printHelp();
          break;
        case "start":
          await runStart(args);
          break;
        case "stop":
          await runStop(args);
          break;
        case "status":
          await runStatus(args);
          break;
        case "db":
          await runDb(args);
          break;
        case "diag":
          await runDiag(args);
          break;
        case "query":
          await runQuery(args);
          break;
        case "telemetry":
          await runTelemetry(args);
          break;
        case "doctor":
          await runDoctor(args);
          break;
        case "config":
          await runConfig(args);
          break;
        case "profile":
          runProfile(args);
          break;
        case "serve":
          await runServe(args);
          break;
        case "test":
          await runTest(args);
          break;
        case "ask":
          await runAsk(args);
          break;
        case "vault":
          await runVault(args);
          break;
        case "audit":
          await runAudit(args);
          break;
        case "connector":
          await runConnector(args);
          break;
        case "data":
          await runData(args);
          break;
        case "extension":
          await runExtension(args);
          break;
        case "people":
          await runPeople(args);
          break;
        case "search":
          await runSearch(args);
          break;
        case "session":
          await runSession(args);
          break;
        case "workflow":
          await runWorkflowCli(args);
          break;
        case "watch":
          await runWatch(args);
          break;
        case "repl":
          await runRepl(args);
          break;
        case "run":
          await runWorkflowFromFile(args);
          break;
        case "scaffold":
          await runScaffold(args);
          break;
        default:
          console.error(`Unknown command: ${command}`);
          printHelp();
          process.exitCode = 1;
      }
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
