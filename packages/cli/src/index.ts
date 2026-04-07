/**
 * Nimbus CLI — nimbus <command> [options]
 *
 * Commands:
 *   start       Start the Gateway as a background process
 *   stop        Stop the Gateway
 *   status      Verify Gateway is running; list connector health
 *   ask         Submit a natural-language query to the agent
 *   search      Structured search across the local index
 *   sync        Trigger a sync for one or all connectors
 *   connector   Manage connectors (auth, list, pause, status)
 *   extension   Manage extensions (install, list, disable, remove)
 *   vault       Manage stored secrets (set, get, delete, list)
 *   watch       Manage ambient monitors (create, list, pause, delete)
 */

import { intro, outro } from "@clack/prompts";

const [, , command = "help", ...args] = process.argv;

async function main(): Promise<void> {
  intro("Nimbus");

  // TODO Q1: Wire up command router (command and args available)
  void command;
  void args;

  outro("Done.");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
