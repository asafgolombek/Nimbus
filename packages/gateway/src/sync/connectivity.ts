/**
 * Network connectivity probe — guards the sync scheduler against consuming
 * backoff attempts on offline events (laptop sleeping through bad Wi-Fi, etc.).
 *
 * Strategy: DNS resolution of a well-known hostname.
 *  - No TCP connection is opened and no data is sent.
 *  - `one.one.one.one` (Cloudflare's resolver) is the default probe host —
 *    it resolves to 1.1.1.1 on virtually all networks and is less likely to
 *    be blocked on restricted corporate networks than 8.8.8.8 (Google).
 *  - The probe host is configurable via `[sync.connectivity_probe_host]` so
 *    air-gapped or custom-DNS environments can override it.
 *
 * Usage:
 *   const online = await isOnline();
 *   if (!online) { ... suspend dispatch without consuming backoff ... }
 */

export const DEFAULT_CONNECTIVITY_PROBE_HOST = "one.one.one.one";

/**
 * Returns `true` if the machine appears to be online (DNS resolution succeeds
 * for `probeHost`), `false` otherwise.
 *
 * Never throws — all errors are treated as offline.
 */
export async function isOnline(
  probeHost: string = DEFAULT_CONNECTIVITY_PROBE_HOST,
): Promise<boolean> {
  try {
    await Bun.dns.lookup(probeHost);
    return true;
  } catch {
    return false;
  }
}
