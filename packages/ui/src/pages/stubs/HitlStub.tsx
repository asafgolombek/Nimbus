import { invoke } from "@tauri-apps/api/core";
import type { ReactNode } from "react";
import { PageHeader } from "../../components/chrome/PageHeader";
import { useNimbusStore } from "../../store";

export function HitlStub(): ReactNode {
  const pending = useNimbusStore((s) => s.pending.length);
  return (
    <>
      <PageHeader title="HITL" />
      <div className="p-6">
        <p className="text-sm text-[var(--color-fg-muted)]">
          {pending === 0
            ? "No pending actions."
            : `${pending} pending action${pending === 1 ? "" : "s"}.`}
        </p>
        {pending > 0 && (
          <button
            type="button"
            className="mt-3 px-3 py-1 bg-[var(--color-accent)] text-white rounded"
            onClick={() => void invoke("open_hitl_popup").catch(() => undefined)}
          >
            Open popup
          </button>
        )}
        <p className="text-xs text-[var(--color-fg-muted)] mt-6">
          Full pending list + history lands in a later sub-project.
        </p>
      </div>
    </>
  );
}
