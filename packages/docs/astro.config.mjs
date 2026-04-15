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
      ],
    }),
  ],
});
