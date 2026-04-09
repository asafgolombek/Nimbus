import { existsSync } from "node:fs";

import {
  findNimbusRepoRootFromDirs,
  getNimbusRepoSearchStartDirs,
} from "./resolve-gateway-launch.ts";

/**
 * Monorepo root (directory containing workspace `package.json`), when running from a checkout.
 * Walks up from the CLI executable and this module's location.
 */
export function getRepoRoot(): string {
  const root = findNimbusRepoRootFromDirs(
    getNimbusRepoSearchStartDirs(process.execPath, import.meta.url),
    existsSync,
  );
  if (root === undefined) {
    throw new Error(
      'Could not find Nimbus monorepo root (expected root package.json with name "nimbus" and workspaces).',
    );
  }
  return root;
}
