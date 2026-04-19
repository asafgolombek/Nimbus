import { Outlet } from "react-router-dom";
import { GatewayOfflineBanner } from "../components/GatewayOfflineBanner";
import { HotkeyFailedBanner } from "../components/HotkeyFailedBanner";
import { useNimbusStore } from "../store";

export function RootLayout() {
  const connectionState = useNimbusStore((s) => s.connectionState);
  const offline = connectionState === "disconnected";
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      {offline && <GatewayOfflineBanner />}
      <HotkeyFailedBanner />
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <Outlet />
      </div>
    </div>
  );
}
