export type AuditEmit = (action: string, payload: Record<string, unknown>) => Promise<void>;

export interface AuditLogger {
  log(action: string, payload: Record<string, unknown>): Promise<void>;
}

export function createScopedAuditLogger(extensionId: string, emit: AuditEmit): AuditLogger {
  if (!extensionId || extensionId.trim().length === 0) {
    throw new Error("extensionId must be non-empty");
  }
  return {
    async log(action, payload) {
      if (!action || action.length === 0) {
        throw new Error("action must be non-empty");
      }
      if (action.includes(":")) {
        throw new Error("action must not contain a colon (scoping prefix is added automatically)");
      }
      const scoped = `${extensionId}:${action}`;
      await emit(scoped, payload);
    },
  };
}
