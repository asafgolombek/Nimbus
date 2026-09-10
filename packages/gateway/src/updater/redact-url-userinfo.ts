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
 *
 * The userinfo and authority parts are UNBOUNDED, and that is load-bearing rather than sloppy.
 * They were `{1,256}` until 2026-09-10, which failed open in the two worst ways a redactor can:
 * a userinfo longer than 256 characters (an ordinary length for a bearer token or PAT) matched
 * NOTHING and shipped the credential verbatim, and `https://user:secret@` with an empty authority
 * did the same because the host class demanded at least one character. Both now match — the
 * second one lands in the `catch` arm, since `new URL` rejects an empty host, and is replaced
 * wholesale.
 *
 * Unbounding is safe here: there is no nesting, and the classes are disjoint at the boundary
 * (`[^\s/@]` cannot match the `@` that must follow it), so the match is unambiguous and linear.
 * `updater.test.ts` asserts that on a 200,000-character adversarial input rather than trusting it.
 * The scheme class keeps its `{1,32}` bound — a scheme is short by definition and the ceiling
 * costs nothing there.
 */
const URL_USERINFO_RE = /[a-zA-Z0-9+\-.]{1,32}:\/\/[^\s/@]+@[^\s/]*/g;

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
