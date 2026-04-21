import { vi } from "vitest";

// Module-scope `vi.fn()` instances are stable across `createIpcClient()` calls.
// Tests import these directly to set up mocked return values / rejections.

export const callMock = vi.fn<(method: string, params?: unknown) => Promise<unknown>>();
export const subscribeMock = vi.fn<
  (handler: (n: { method: string; params: unknown }) => void) => Promise<() => void>
>(async () => () => {});
export const onConnectionStateMock = vi.fn<() => Promise<() => void>>(async () => () => {});

// WS5-B
export const connectorListStatusMock = vi.fn<() => Promise<unknown>>();
export const indexMetricsMock = vi.fn<() => Promise<unknown>>();
export const auditListMock = vi.fn<(limit?: number) => Promise<unknown>>();
export const consentRespondMock = vi.fn<(requestId: string, approved: boolean) => Promise<void>>(
  async () => undefined,
);

// WS5-C Plan 2 additions
export const profileListMock = vi.fn<() => Promise<unknown>>();
export const profileCreateMock = vi.fn<(name: string) => Promise<unknown>>();
export const profileSwitchMock = vi.fn<(name: string) => Promise<unknown>>();
export const profileDeleteMock = vi.fn<(name: string) => Promise<unknown>>();
export const telemetryGetStatusMock = vi.fn<() => Promise<unknown>>();
export const telemetrySetEnabledMock = vi.fn<(enabled: boolean) => Promise<unknown>>();

export const createIpcClient = () => ({
  call: callMock,
  subscribe: subscribeMock,
  onConnectionState: onConnectionStateMock,
  connectorListStatus: connectorListStatusMock,
  indexMetrics: indexMetricsMock,
  auditList: auditListMock,
  consentRespond: consentRespondMock,
  profileList: profileListMock,
  profileCreate: profileCreateMock,
  profileSwitch: profileSwitchMock,
  profileDelete: profileDeleteMock,
  telemetryGetStatus: telemetryGetStatusMock,
  telemetrySetEnabled: telemetrySetEnabledMock,
});

export const __resetIpcClientForTests = () => {};
