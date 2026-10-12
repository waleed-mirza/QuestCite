import { describe, expect, it } from "vitest";

import { isPlatformAdminEmail } from "@/server/authorization/platform-admin";

describe("platform admin allowlist", () => {
  it("matches verified email addresses case-insensitively", () => {
    expect(isPlatformAdminEmail(" Admin@Example.com ", ["admin@example.com"])).toBe(true);
    expect(isPlatformAdminEmail("other@example.com", ["admin@example.com"])).toBe(false);
    expect(isPlatformAdminEmail("", ["admin@example.com"])).toBe(false);
  });
});
