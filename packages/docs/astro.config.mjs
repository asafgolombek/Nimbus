// @ts-check
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightLinksValidator from "starlight-links-validator";

export default defineConfig({
  integrations: [
    starlight({
      title: "Nimbus",
      plugins: [starlightLinksValidator()],
      sidebar: [
        { label: "Home", link: "/" },
        { label: "Getting started", link: "/getting-started/" },
        {
          label: "Connectors",
          items: [{ label: "Overview", link: "/connectors/overview/" }],
        },
        { label: "Query & HTTP API", link: "/query-and-http/" },
        { label: "Telemetry", link: "/telemetry/" },
        { label: "@nimbus-dev/client", link: "/client-library/" },
        { label: "Architecture overview", link: "/architecture-overview/" },
        { label: "FAQ", link: "/faq/" },
      ],
    }),
  ],
});
