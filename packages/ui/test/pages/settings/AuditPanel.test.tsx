import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/ipc/client");
vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  writeTextFile: vi.fn(),
}));

import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import {
  auditExportMock,
  auditGetSummaryMock,
  auditVerifyMock,
  callMock,
} from "../../../src/ipc/__mocks__/client";
import { AuditPanel } from "../../../src/pages/settings/AuditPanel";
import { useNimbusStore } from "../../../src/store";

const saveMock = vi.mocked(save);
const writeTextFileMock = vi.mocked(writeTextFile);

const SAMPLE_ROWS = [
  {
    id: 3,
    actionType: "github.sync",
    hitlStatus: "approved" as const,
    actionJson: "{}",
    timestamp: 1745126400000,
  },
  {
    id: 2,
    actionType: "data.delete",
    hitlStatus: "rejected" as const,
    actionJson: "{}",
    timestamp: 1745122800000,
  },
  {
    id: 1,
    actionType: "startup",
    hitlStatus: "not_required" as const,
    actionJson: "{}",
    timestamp: 1745119200000,
  },
];

beforeEach(() => {
  callMock.mockReset();
  auditGetSummaryMock.mockReset();
  auditVerifyMock.mockReset();
  auditExportMock.mockReset();
  saveMock.mockReset();
  writeTextFileMock.mockReset();
  useNimbusStore.setState({
    connectionState: "connected",
    auditFilter: { service: "", outcome: "all", sinceMs: null, untilMs: null },
    auditSummary: null,
    auditActionInFlight: false,
  } as never);
  callMock.mockImplementation(async (method: string) => {
    if (method === "audit.list") return SAMPLE_ROWS;
    return [];
  });
  auditGetSummaryMock.mockResolvedValue({
    byOutcome: { approved: 1, rejected: 1, not_required: 1 },
    byService: { github: 1, data: 1, startup: 1 },
    total: 3,
  });
});

afterEach(() => {
  useNimbusStore.setState({
    auditFilter: { service: "", outcome: "all", sinceMs: null, untilMs: null },
    auditSummary: null,
    auditActionInFlight: false,
  } as never);
});

async function renderAndWaitForRows(): Promise<void> {
  render(<AuditPanel />);
  await waitFor(() => expect(screen.getAllByTestId("audit-row").length).toBe(3));
}

describe("AuditPanel", () => {
  it("renders summary and one row per fetched entry", async () => {
    render(<AuditPanel />);
    await waitFor(() => expect(screen.getAllByTestId("audit-row").length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByText(/Total rows: 3/)).toBeTruthy());
    expect(screen.getByText("3 of 3 rows")).toBeTruthy();
  });

  it("filters by service via the chip", async () => {
    await renderAndWaitForRows();
    const select = screen.getByLabelText("Service filter") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "github" } });
    await waitFor(() => expect(screen.getAllByTestId("audit-row").length).toBe(1));
    expect(screen.getByText("1 of 3 rows")).toBeTruthy();
  });

  it("Verify chain success surfaces a green toast", async () => {
    auditVerifyMock.mockResolvedValueOnce({ ok: true, lastVerifiedId: 3, totalChecked: 3 });
    await renderAndWaitForRows();
    fireEvent.click(screen.getByRole("button", { name: "Verify chain" }));
    await waitFor(() =>
      expect(screen.getByTestId("audit-toast-text").textContent).toMatch(/Chain verified/),
    );
  });

  it("Verify chain broken surfaces a red toast with the broken id", async () => {
    auditVerifyMock.mockResolvedValueOnce({
      ok: false,
      brokenAtId: 7,
      expectedHash: "expected_hash_value",
      actualHash: "actual_hash_value",
    });
    await renderAndWaitForRows();
    fireEvent.click(screen.getByRole("button", { name: "Verify chain" }));
    await waitFor(() =>
      expect(screen.getByTestId("audit-toast-text").textContent).toMatch(/BROKEN at id 7/),
    );
  });

  it("Export with .json path writes flattened display rows as JSON", async () => {
    saveMock.mockResolvedValueOnce("/mock-export/audit-test.json");
    auditExportMock.mockResolvedValueOnce([
      {
        id: 3,
        actionType: "github.sync",
        hitlStatus: "approved",
        actionJson: '{"actor":"alice"}',
        timestamp: 1,
        rowHash: "abc",
        prevHash: "0",
      },
    ]);
    writeTextFileMock.mockResolvedValueOnce(undefined);
    await renderAndWaitForRows();
    fireEvent.click(screen.getByRole("button", { name: "Export…" }));
    await waitFor(() => expect(writeTextFileMock).toHaveBeenCalled());
    const [path, contents] = writeTextFileMock.mock.calls[0]!;
    expect(path).toBe("/mock-export/audit-test.json");
    const parsed = JSON.parse(contents as string) as Array<{ service: string; actor: string }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.service).toBe("github");
    expect(parsed[0]?.actor).toBe("alice");
  });

  it("Export with .csv path writes the 6-column CSV", async () => {
    saveMock.mockResolvedValueOnce("/mock-export/audit-test.csv");
    auditExportMock.mockResolvedValueOnce([
      {
        id: 3,
        actionType: "github.sync",
        hitlStatus: "approved",
        actionJson: '{"actor":"alice"}',
        timestamp: 1,
        rowHash: "abc",
        prevHash: "0",
      },
    ]);
    writeTextFileMock.mockResolvedValueOnce(undefined);
    await renderAndWaitForRows();
    fireEvent.click(screen.getByRole("button", { name: "Export…" }));
    await waitFor(() => expect(writeTextFileMock).toHaveBeenCalled());
    const [, contents] = writeTextFileMock.mock.calls[0]!;
    const [header, line] = (contents as string).split("\n");
    expect(header).toBe("timestamp,service,actor,action,outcome,rowHash");
    expect(line).toContain("github");
    expect(line).toContain("alice");
    expect(line).toContain("abc");
  });

  it("Export cancelled (save returns null) writes nothing", async () => {
    saveMock.mockResolvedValueOnce(null);
    await renderAndWaitForRows();
    fireEvent.click(screen.getByRole("button", { name: "Export…" }));
    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    expect(writeTextFileMock).not.toHaveBeenCalled();
    expect(auditExportMock).not.toHaveBeenCalled();
  });

  it("disconnected state disables write buttons", async () => {
    useNimbusStore.setState({ connectionState: "disconnected" } as never);
    render(<AuditPanel />);
    expect(
      (screen.getByRole("button", { name: "Verify chain" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByRole("button", { name: "Export…" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
