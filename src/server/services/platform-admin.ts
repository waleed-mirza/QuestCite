import "server-only";

import { z } from "zod";

import { logger } from "@/lib/observability/logger";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const organizationSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  slug: z.string().min(1),
  status: z.enum(["active", "deactivated"]),
  updated_at: z.string(),
});

const subscriptionSchema = z.object({
  organization_id: z.uuid(),
  plan_code: z.string().min(1),
  status: z.enum(["none", "trialing", "active", "past_due", "paused", "cancelled", "expired"]),
  renews_at: z.string().nullable(),
  ends_at: z.string().nullable(),
});

const runSchema = z.object({
  organization_id: z.uuid(),
  status: z.string().min(1),
});

export type PlatformOrgHealth = {
  organizationId: string;
  organizationName: string;
  slug: string;
  status: "active" | "deactivated";
  updatedAt: string;
  planCode: string;
  subscriptionStatus: string;
  renewsAt: string | null;
  endsAt: string | null;
  jobs: { pending: number; running: number; completed: number; failed: number; other: number };
};

export async function getPlatformOrgHealth(): Promise<PlatformOrgHealth[] | null> {
  try {
    const admin = createSupabaseAdminClient();
    const [organizations, subscriptions, runs] = await Promise.all([
      admin.from("organizations").select("id,name,slug,status,updated_at").order("updated_at", { ascending: false }).limit(100),
      admin.from("subscriptions").select("organization_id,plan_code,status,renews_at,ends_at"),
      admin.from("answer_runs").select("organization_id,status").limit(10_000),
    ]);
    if (organizations.error !== null || subscriptions.error !== null || runs.error !== null) {
      logger.warn("platform.health.query_failed", { code: "PLATFORM_HEALTH_QUERY_FAILED" });
      return null;
    }

    const orgRows = z.array(organizationSchema).safeParse(organizations.data ?? []);
    const subscriptionRows = z.array(subscriptionSchema).safeParse(subscriptions.data ?? []);
    const runRows = z.array(runSchema).safeParse(runs.data ?? []);
    if (!orgRows.success || !subscriptionRows.success || !runRows.success) {
      logger.warn("platform.health.invalid", { code: "PLATFORM_HEALTH_INVALID" });
      return null;
    }

    const subscriptionByOrg = new Map(subscriptionRows.data.map((row) => [row.organization_id, row]));
    const jobsByOrg = new Map<string, PlatformOrgHealth["jobs"]>();
    for (const run of runRows.data) {
      const jobs = jobsByOrg.get(run.organization_id) ?? { pending: 0, running: 0, completed: 0, failed: 0, other: 0 };
      if (run.status === "pending") jobs.pending += 1;
      else if (run.status === "running") jobs.running += 1;
      else if (run.status === "completed") jobs.completed += 1;
      else if (run.status === "failed") jobs.failed += 1;
      else jobs.other += 1;
      jobsByOrg.set(run.organization_id, jobs);
    }

    return orgRows.data.map((organization) => {
      const subscription = subscriptionByOrg.get(organization.id);
      return {
        organizationId: organization.id,
        organizationName: organization.name,
        slug: organization.slug,
        status: organization.status,
        updatedAt: organization.updated_at,
        planCode: subscription?.plan_code ?? "trial",
        subscriptionStatus: subscription?.status ?? "none",
        renewsAt: subscription?.renews_at ?? null,
        endsAt: subscription?.ends_at ?? null,
        jobs: jobsByOrg.get(organization.id) ?? { pending: 0, running: 0, completed: 0, failed: 0, other: 0 },
      } satisfies PlatformOrgHealth;
    });
  } catch {
    logger.warn("platform.health.unavailable", { code: "PLATFORM_HEALTH_UNAVAILABLE" });
    return null;
  }
}
