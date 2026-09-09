import type { ToolgenEnvelope } from "./toolgen-types.ts";

interface Entry {
  readonly envelope: ToolgenEnvelope;
  readonly close: () => Promise<void>;
  terminated: boolean;
}

/**
 * Ephemeral, session-keyed registry of live generated tools.
 *
 * IN-MEMORY ONLY, and that is the feature: a gateway restart drops every generated tool, so
 * "ephemeral for the session" is true by construction rather than by a cleanup job. Same shape as
 * I30's in-memory pairing window. PR 1 adds no schema migration precisely because of this.
 */
export class ToolgenRegistry {
  readonly #byId = new Map<string, Entry>();

  register(envelope: ToolgenEnvelope, close: () => Promise<void>): void {
    this.#byId.set(envelope.artifact.toolId, { envelope, close, terminated: false });
  }

  get(toolId: string): ToolgenEnvelope | undefined {
    return this.#byId.get(toolId)?.envelope;
  }

  /** Live tools only. A terminated tool is not offered to the model as though it still worked. */
  forSession(sessionId: string): ToolgenEnvelope[] {
    return [...this.#byId.values()]
      .filter((e) => !e.terminated && e.envelope.sessionId === sessionId)
      .map((e) => e.envelope);
  }

  /** Counts live tools only, so a crashed tool does not permanently consume session budget. */
  countForSession(sessionId: string): number {
    return this.forSession(sessionId).length;
  }

  /**
   * The child process exited. The tool is NOT silently restarted: a restart re-runs approved code
   * the owner may reasonably believe stopped, and "it came back on its own" is not a property
   * anyone approved.
   */
  markTerminated(toolId: string): void {
    const entry = this.#byId.get(toolId);
    if (entry !== undefined) entry.terminated = true;
  }

  isTerminated(toolId: string): boolean {
    return this.#byId.get(toolId)?.terminated ?? false;
  }

  async revoke(toolId: string): Promise<void> {
    const entry = this.#byId.get(toolId);
    if (entry === undefined) return;
    this.#byId.delete(toolId);
    await entry.close();
  }

  /** Shutdown drain. One failing close must not strand the remaining child processes. */
  async revokeAll(): Promise<void> {
    const entries = [...this.#byId.values()];
    this.#byId.clear();
    await Promise.allSettled(entries.map((e) => e.close()));
  }
}
