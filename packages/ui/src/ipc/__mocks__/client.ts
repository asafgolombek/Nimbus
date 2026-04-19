import { vi } from "vitest";

export const callMock = vi.fn<(method: string, params?: unknown) => Promise<unknown>>();

export const createIpcClient = () => ({
  call: callMock,
  subscribe: vi.fn(async (): Promise<() => void> => () => {}),
  onConnectionState: vi.fn(async (): Promise<() => void> => () => {}),
});
