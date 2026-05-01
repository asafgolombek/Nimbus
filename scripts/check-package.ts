#!/usr/bin/env bun
// Quick safety check for npm package names. Run before `bun add <name>` to
// catch typosquats and brand-new (potentially slopsquatted) packages.
//
// Usage: bun run check-package <package-name>
//
// Exit codes:
//   0  package exists; metadata printed
//   1  package does not exist on the npm registry, or registry / network error
//   2  usage error (no argv)

type RegistryDoc = {
  name?: string;
  time?: Record<string, string>;
  versions?: Record<string, unknown>;
  maintainers?: Array<{ name?: string; email?: string }>;
  author?: { name?: string; email?: string } | string;
};

// Pre-built regex matching C0 (U+0000-U+001F) and C1 (U+007F-U+009F) control
// characters EXCEPT TAB (0x09), LF (0x0A), and CR (0x0D), which are kept
// because real npm metadata fields occasionally contain them. Built from
// String.fromCharCode so this source file holds no literal control characters.
const _CTRL_CHARS = (() => {
  const allowed = new Set([0x09, 0x0a, 0x0d]);
  let chars = "";
  for (let cp = 0x00; cp <= 0x1f; cp++) {
    if (!allowed.has(cp)) chars += String.fromCodePoint(cp);
  }
  for (let cp = 0x7f; cp <= 0x9f; cp++) chars += String.fromCodePoint(cp);
  return chars;
})();
const CTRL_RE = new RegExp(`[${_CTRL_CHARS.replaceAll(/[\\\]^-]/g, String.raw`\$&`)}]`, "g");

/**
 * Strip C0/C1 control characters from registry-fetched strings before
 * logging. Mitigates terminal-injection (ANSI / control-sequence) risk when
 * an attacker-controlled npm package field contains escape codes. TAB / LF /
 * CR are preserved because real package descriptions sometimes contain them.
 */
function sanitize(value: unknown): string {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return s.replaceAll(CTRL_RE, "?");
}

function safeLog(label: string, value: unknown): void {
  console.log(`${label}: ${sanitize(value)}`);
}

const pkgName = Bun.argv[2];
if (!pkgName) {
  console.error("usage: bun run check-package <package-name>");
  process.exit(2);
}

const url = `https://registry.npmjs.org/${encodeURIComponent(pkgName)}`;

let res: Response;
try {
  res = await fetch(url, {
    headers: { "user-agent": "nimbus-check-package/1.0 (+https://github.com/asafgolombek/Nimbus)" },
  });
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`network error fetching ${url}: ${msg}`);
  process.exit(1);
}

if (res.status === 404) {
  console.error(`package "${pkgName}" not found on npm registry`);
  process.exit(1);
}
if (!res.ok) {
  console.error(`registry returned HTTP ${res.status} for "${pkgName}"`);
  process.exit(1);
}

const doc = (await res.json()) as RegistryDoc;

const created = doc.time?.created;
const versionCount = Object.keys(doc.versions ?? {}).length;
const maintainers =
  (doc.maintainers ?? []).map((m) => m?.name ?? m?.email ?? "<anonymous>").join(", ") || "<none>";
const author = typeof doc.author === "string" ? doc.author : (doc.author?.name ?? "<none>");

safeLog("Package      ", doc.name ?? pkgName);
safeLog("Author       ", author);
safeLog("Maintainers  ", maintainers);
safeLog("Created      ", created ?? "<unknown>");
console.log(`Version count: ${versionCount}`);

if (created) {
  const ageDays = (Date.now() - Date.parse(created)) / (1000 * 60 * 60 * 24);
  if (Number.isFinite(ageDays) && ageDays < 7) {
    console.warn(
      `WARNING: package is ${ageDays.toFixed(1)} days old (< 7 days). ` +
        "Brand-new packages are a common slopsquatting / typosquatting vector — " +
        "verify the source before installing.",
    );
  }
}
