/**
 * Destructive hosted operations need an explicit acknowledgement once the
 * linked Supabase project is promoted. The override is intentionally a
 * one-command environment value rather than a committed default.
 */
export type ProtectedOperation = "hosted-tests" | "demo-seed";

const OVERRIDE_KEYS: Record<ProtectedOperation, string> = {
  "hosted-tests": "ALLOW_HOSTED_TEST_MUTATIONS",
  "demo-seed": "ALLOW_DEMO_SEED_IN_PRODUCTION",
};

const BLOCK_CODES: Record<ProtectedOperation, string> = {
  "hosted-tests": "HOSTED_TESTS_BLOCKED_IN_PRODUCTION",
  "demo-seed": "DEMO_SEED_BLOCKED_IN_PRODUCTION",
};

export function assertProtectedOperationAllowed(
  operation: ProtectedOperation,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): void {
  if (environment.APP_ENV !== "production") {
    return;
  }

  const overrideKey = OVERRIDE_KEYS[operation];
  if (environment[overrideKey] === "true") {
    return;
  }

  throw new Error(BLOCK_CODES[operation]);
}
