import { createManifestHandler } from "@saleor/app-sdk/handlers/next-app-router";
import { AppManifest } from "@saleor/app-sdk/types";

import { env } from "@/lib/env";

import packageJson from "../../../../package.json";
import { appWebhooks } from "../../../../webhooks";

const handler = createManifestHandler({
  async manifestFactory({ appBaseUrl }) {
    const iframeBaseUrl = env.APP_IFRAME_BASE_URL ?? appBaseUrl;
    const apiBaseURL = env.APP_API_BASE_URL ?? appBaseUrl;

    const manifest: AppManifest = {
      about: "App provides tax rate calculation using Zip2Tax API with ZIP+4 code lookup and intelligent caching",
      appUrl: iframeBaseUrl,
      author: "Saleor Commerce",
      brand: {
        logo: {
          default: `${apiBaseURL}/logo.png`,
        },
      },
      dataPrivacyUrl: "https://saleor.io/legal/privacy/",
      homepageUrl: "https://github.com/saleor/apps",
      id: env.MANIFEST_APP_ID,
      name: "Zip2Tax",
      permissions: ["HANDLE_TAXES"],
      requiredSaleorVersion: ">=3.19 <4",
      supportUrl: "https://github.com/saleor/apps/discussions",
      tokenTargetUrl: `${apiBaseURL}/api/register`,
      version: packageJson.version,
      webhooks: appWebhooks.map((w) => w.getWebhookManifest(apiBaseURL)),
      extensions: [],
    };

    return manifest;
  },
});

export const GET = handler;