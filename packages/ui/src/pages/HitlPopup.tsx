import type { ReactNode } from "react";
import { HitlPopupPage } from "../components/hitl/HitlPopupPage";

export function HitlPopup(): ReactNode {
  return (
    <div className="w-screen h-screen bg-[var(--color-bg)] text-[var(--color-fg)]">
      <HitlPopupPage />
    </div>
  );
}
