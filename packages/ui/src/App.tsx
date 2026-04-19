import type { ReactNode } from "react";
import {
  createBrowserRouter,
  createRoutesFromElements,
  Navigate,
  Route,
  RouterProvider,
} from "react-router-dom";
import { RootLayout } from "./layouts/RootLayout";
import { Dashboard } from "./pages/Dashboard";
import { HitlPopup } from "./pages/HitlPopup";
import { Onboarding } from "./pages/Onboarding";
import { Connect } from "./pages/onboarding/Connect";
import { Syncing } from "./pages/onboarding/Syncing";
import { Welcome } from "./pages/onboarding/Welcome";
import { QuickQuery } from "./pages/QuickQuery";
import { HitlStub } from "./pages/stubs/HitlStub";
import { MarketplaceStub } from "./pages/stubs/MarketplaceStub";
import { SettingsStub } from "./pages/stubs/SettingsStub";
import { WatchersStub } from "./pages/stubs/WatchersStub";
import { WorkflowsStub } from "./pages/stubs/WorkflowsStub";
import { GatewayConnectionProvider } from "./providers/GatewayConnectionProvider";

function Wrapper({ children }: { readonly children: ReactNode }) {
  return <GatewayConnectionProvider>{children}</GatewayConnectionProvider>;
}

const router = createBrowserRouter(
  createRoutesFromElements(
    <Route
      element={
        <Wrapper>
          <RootLayout />
        </Wrapper>
      }
    >
      <Route index element={<Dashboard />} />
      <Route path="onboarding" element={<Onboarding />}>
        <Route index element={<Navigate to="welcome" replace />} />
        <Route path="welcome" element={<Welcome />} />
        <Route path="connect" element={<Connect />} />
        <Route path="syncing" element={<Syncing />} />
      </Route>
      <Route path="quick" element={<QuickQuery />} />
      <Route path="hitl-popup" element={<HitlPopup />} />
      <Route path="hitl" element={<HitlStub />} />
      <Route path="settings" element={<SettingsStub />} />
      <Route path="marketplace" element={<MarketplaceStub />} />
      <Route path="watchers" element={<WatchersStub />} />
      <Route path="workflows" element={<WorkflowsStub />} />
    </Route>,
  ),
);

export function App() {
  return <RouterProvider router={router} />;
}
