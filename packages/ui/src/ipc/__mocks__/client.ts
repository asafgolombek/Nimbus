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

// WS5-C Plan 3 additions
export const connectorSetConfigMock =
  vi.fn<(service: string, patch: Record<string, unknown>) => Promise<unknown>>();
export const llmListModelsMock = vi.fn<() => Promise<unknown>>();
export const llmGetStatusMock = vi.fn<() => Promise<unknown>>();
export const llmGetRouterStatusMock = vi.fn<() => Promise<unknown>>();
export const llmPullModelMock = vi.fn<(provider: string, modelName: string) => Promise<unknown>>();
export const llmCancelPullMock = vi.fn<(pullId: string) => Promise<unknown>>();
export const llmLoadModelMock = vi.fn<(provider: string, modelName: string) => Promise<unknown>>();
export const llmUnloadModelMock =
  vi.fn<(provider: string, modelName: string) => Promise<unknown>>();
export const llmSetDefaultMock =
  vi.fn<(taskType: string, provider: string, modelName: string) => Promise<unknown>>();

// WS5-C Plan 4 additions
export const auditGetSummaryMock = vi.fn<() => Promise<unknown>>();
export const auditVerifyMock = vi.fn<(full?: boolean) => Promise<unknown>>();
export const auditExportMock = vi.fn<() => Promise<unknown>>();
export const updaterGetStatusMock = vi.fn<() => Promise<unknown>>();
export const updaterCheckNowMock = vi.fn<() => Promise<unknown>>();
export const updaterApplyUpdateMock = vi.fn<() => Promise<unknown>>();
export const updaterRollbackMock = vi.fn<() => Promise<unknown>>();
export const diagGetVersionMock = vi.fn<() => Promise<unknown>>();

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
  connectorSetConfig: connectorSetConfigMock,
  llmListModels: llmListModelsMock,
  llmGetStatus: llmGetStatusMock,
  llmGetRouterStatus: llmGetRouterStatusMock,
  llmPullModel: llmPullModelMock,
  llmCancelPull: llmCancelPullMock,
  llmLoadModel: llmLoadModelMock,
  llmUnloadModel: llmUnloadModelMock,
  llmSetDefault: llmSetDefaultMock,
  auditGetSummary: auditGetSummaryMock,
  auditVerify: auditVerifyMock,
  auditExport: auditExportMock,
  updaterGetStatus: updaterGetStatusMock,
  updaterCheckNow: updaterCheckNowMock,
  updaterApplyUpdate: updaterApplyUpdateMock,
  updaterRollback: updaterRollbackMock,
  diagGetVersion: diagGetVersionMock,
});

export const __resetIpcClientForTests = () => {};
