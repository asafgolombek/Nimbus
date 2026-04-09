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
  runStart,
  runStatus,
  runStop,
  runVault,
} from "./commands/index.ts";

const [, , command = "help", ...args] = process.argv;

intro("Nimbus");

try {
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
    case "ask":
      await runAsk(args);
      break;
    case "vault":
      await runVault(args);
      break;
    case "audit":
      await runAudit(args);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exitCode = 1;
  }
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(msg);
  process.exitCode = 1;
}

outro("Done.");
