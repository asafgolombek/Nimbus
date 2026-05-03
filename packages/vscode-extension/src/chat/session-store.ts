import type { MementoLike } from "../vscode-shim.js";

const KEY = "nimbus.activeSessionId";

export interface SessionStore {
  get(): string | undefined;
  set(sessionId: string): Promise<void>;
  clear(): Promise<void>;
}

export function createSessionStore(memento: MementoLike): SessionStore {
  return {
    get: () => memento.get<string>(KEY),
    set: async (sessionId) => {
      if (typeof sessionId !== "string" || sessionId.length === 0) {
        throw new Error("SessionStore.set requires a non-empty sessionId");
      }
      await memento.update(KEY, sessionId);
    },
    clear: async () => {
      await memento.update(KEY, undefined);
    },
  };
}
