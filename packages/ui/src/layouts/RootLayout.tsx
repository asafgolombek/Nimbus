import { emit } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { Sidebar } from "../components/chrome/Sidebar";
import { GatewayOfflineBanner } from "../components/GatewayOfflineBanner";
import { HotkeyFailedBanner } from "../components/HotkeyFailedBanner";
import { useIpcSubscription } from "../hooks/useIpcSubscription";
import { useNimbusStore } from "../store";

export function RootLayout() {
  const connectionState = useNimbusStore((s) => s.connectionState);
  const aggregateHealth = useNimbusStore((s) => s.aggregateHealth);
  const pendingHitl = useNimbusStore((s) => s.pendingHitl);
  const requestHighlight = useNimbusStore((s) => s.requestHighlight);
  const clearHighlight = useNimbusStore((s) => s.clearHighlight);
  const offline = connectionState === "disconnected";
  const navigate = useNavigate();

  useEffect(() => {
    void emit("tray://state-changed", { icon: aggregateHealth, badge: pendingHitl }).catch(() => {
      // Non-fatal; tray will pick up the next change.
    });
  }, [aggregateHealth, pendingHitl]);

  useIpcSubscription<{ name: string }>("tray://open-connector", (p) => {
    void navigate("/");
    requestHighlight(p.name);
    setTimeout(() => clearHighlight(), 1500);
  });

  return (
    <div className="h-screen flex flex-col">
      {offline && <GatewayOfflineBanner />}
      <HotkeyFailedBanner />
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
