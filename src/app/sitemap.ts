import type { MetadataRoute } from "next";

import { appConfig } from "@/config/app";

const PUBLIC_PATHS = ["/", "/demo", "/pricing", "/faq", "/docs", "/privacy", "/terms", "/trust/northstar-cloud"] as const;

/** Sitemap for the public, signed-out marketing and demo surfaces only. */
export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = appConfig.url.replace(/\/$/, "");
  return PUBLIC_PATHS.map((path) => ({
    url: `${baseUrl}${path}`,
  }));
}
