/** Bracket access only — matches gateway `processEnvGet` (CLI must not import gateway). */
export function envGet(name: string): string | undefined {
  return process.env[name];
}
