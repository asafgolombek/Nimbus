/**
 * Strip `user:password@` out of any URL embedded in a diagnostic message.
 *
 * One definition, two consumers: `updater.ts` (`Updater.lastError`, and `platform/assemble.ts`
 * through its re-export) and `manifest-fetcher.ts` (`ManifestFetchError`'s constructor). Both
 * carried their own copy of the regex and the try/catch until 2026-09-10 — identical, and
 * therefore two places for a future broadening to reach only one of. `manifest-fetcher.ts` cannot
 * simply import from `updater.ts` (that file imports `manifest-fetcher.ts`, and circular imports
 * are forbidden), which is why this sits in a third module rather than in either of them.
 *
 * The scheme class is deliberately wider than `[a-zA-Z]+`: it admits `+`, `-`, `.` and digits, so
 * `git+https://`, `svn+ssh://` and `s3://` are matched. Fixtures for each live in
 * `updater.test.ts`; the `s3://` one is the case that leaks a secret verbatim without the digits.
 */
const URL_USERINFO_RE = /[a-zA-Z0-9+\-.]{1,32}:\/\/[^\s/@]{1,256}@[^\s/]{1,256}/g;

export function redactUrlUserinfo(message: string): string {
  return message.replaceAll(URL_USERINFO_RE, (urlMatch) => {
    try {
      const u = new URL(urlMatch);
      u.username = "";
      u.password = "";
      return u.toString();
    } catch {
      return "[REDACTED-URL]";
    }
  });
}
