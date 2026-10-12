import type { MetadataRoute } from "next";

import { appConfig } from "@/config/app";

/** Keep authenticated and mutation surfaces out of search indexes. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/demo", "/pricing", "/faq", "/docs", "/privacy", "/terms", "/trust/"],
      disallow: ["/app/", "/api/", "/auth/", "/onboarding", "/login", "/signup", "/forgot-password", "/reset-password"],
    },
    sitemap: `${appConfig.url.replace(/\/$/, "")}/sitemap.xml`,
    host: appConfig.url,
  };
}
