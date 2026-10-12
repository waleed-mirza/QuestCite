/**
 * Release packaging inventory. The customer ZIP is built from the git tree;
 * these checks define what must NEVER ship.
 */

export interface InventoryViolation {
  readonly kind: "forbidden-path" | "env-file";
  readonly path: string;
  readonly reason: string;
}

/** Paths that must never ship, even if force-added to the public tree. */
export const FORBIDDEN_RELEASE_PATHS: readonly string[] = [
  "memory/",
  "trustops-10-week-production-plan.md",
  "assets/sales/",
];

/** .env files that MAY ship in the release; every other .env* is a leak. */
export const ALLOWED_ENV_FILES: readonly string[] = [".env.example", ".env.test"];

export function auditReleaseInventory(trackedFiles: readonly string[]): InventoryViolation[] {
  const violations: InventoryViolation[] = [];

  for (const file of trackedFiles) {
    const normalized = file.replaceAll("\\", "/");

    for (const forbidden of FORBIDDEN_RELEASE_PATHS) {
      const isForbidden =
        forbidden.endsWith("/") ? normalized.startsWith(forbidden) : normalized === forbidden;
      if (isForbidden) {
        violations.push({
          kind: "forbidden-path",
          path: normalized,
          reason: "private working notes and sales copy must never ship in a release",
        });
      }
    }

    const base = normalized.split("/").pop() ?? normalized;
    if (base.startsWith(".env") && !ALLOWED_ENV_FILES.includes(base)) {
      violations.push({
        kind: "env-file",
        path: normalized,
        reason: "only .env.example and .env.test may ship; real environment files are secrets",
      });
    }
  }

  return violations;
}

/**
 * The packaging transform applied when building a release ZIP. Private notes
 * and sales copy are dropped even if they were force-added. The release audit
 * runs `auditReleaseInventory(filterReleaseFiles(tracked))` and must find
 * nothing.
 */
export function filterReleaseFiles(trackedFiles: readonly string[]): string[] {
  return trackedFiles.filter((file) => {
    const normalized = file.replaceAll("\\", "/");
    return !FORBIDDEN_RELEASE_PATHS.some((forbidden) =>
      forbidden.endsWith("/") ? normalized.startsWith(forbidden) : normalized === forbidden,
    );
  });
}
