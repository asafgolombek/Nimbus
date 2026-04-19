import { Outlet } from "react-router-dom";
import { Sidebar } from "../components/chrome/Sidebar";
import { GatewayOfflineBanner } from "../components/GatewayOfflineBanner";
import { HotkeyFailedBanner } from "../components/HotkeyFailedBanner";
import { useNimbusStore } from "../store";

export function RootLayout() {
  const connectionState = useNimbusStore((s) => s.connectionState);
  const offline = connectionState === "disconnected";
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
