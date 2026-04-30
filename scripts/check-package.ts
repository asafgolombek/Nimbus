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

const name = Bun.argv[2];
if (!name) {
  console.error("usage: bun run check-package <package-name>");
  process.exit(2);
}

const url = `https://registry.npmjs.org/${encodeURIComponent(name)}`;

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
  console.error(`package "${name}" not found on npm registry`);
  process.exit(1);
}
if (!res.ok) {
  console.error(`registry returned HTTP ${res.status} for "${name}"`);
  process.exit(1);
}

const doc = (await res.json()) as RegistryDoc;

const created = doc.time?.created;
const versionCount = Object.keys(doc.versions ?? {}).length;
const maintainers =
  (doc.maintainers ?? []).map((m) => m?.name ?? m?.email ?? "<anonymous>").join(", ") || "<none>";
const author = typeof doc.author === "string" ? doc.author : (doc.author?.name ?? "<none>");

console.log(`Package:       ${doc.name ?? name}`);
console.log(`Author:        ${author}`);
console.log(`Maintainers:   ${maintainers}`);
console.log(`Created:       ${created ?? "<unknown>"}`);
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
