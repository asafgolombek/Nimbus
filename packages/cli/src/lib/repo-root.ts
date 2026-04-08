import { fileURLToPath } from "node:url";

/** Repository root when running from `packages/cli/src/lib/**` (or dist mirror). */
export function getRepoRoot(): string {
  return fileURLToPath(new URL("../../../../", import.meta.url));
}
