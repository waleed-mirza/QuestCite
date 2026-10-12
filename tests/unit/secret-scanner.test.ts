import { describe, expect, it } from "vitest";

import {
  assertFixtureValuesAreFake,
  isPlaceholderValue,
  scanContent,
} from "@/lib/security/secret-scanner";
import {
  auditReleaseInventory,
  filterReleaseFiles,
} from "@/lib/security/release-inventory";

describe("scanContent", () => {
  it("finds realistic OpenAI-style keys", () => {
    const findings = scanContent("config.ts", 'const key = "sk-abcdef0123456789abcdef0123456789";');
    expect(findings).toEqual([{ file: "config.ts", line: 1, pattern: expect.stringContaining("OpenAI") }]);
  });

  it("finds JWT-shaped service keys and private key blocks", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N65IgydYp8ZI";
    expect(scanContent("a.env", `SUPABASE_SERVICE_ROLE_KEY=${jwt}`).length).toBe(1);
    expect(scanContent("key.pem", "-----BEGIN RSA PRIVATE KEY-----").length).toBe(1);
  });

  it("does not flag placeholder-marked values", () => {
    expect(scanContent(".env.test", "OPENAI_API_KEY=fake-openai-key-for-tests")).toEqual([]);
    expect(scanContent(".env.example", "RESEND_API_KEY=your-resend-key")).toEqual([]);
    expect(scanContent("docs.md", "set OPENAI_API_KEY to <your-key>")).toEqual([]);
  });

  it("reports line numbers and never includes the matched value", () => {
    const content = "line1\nline2\nOPENAI_API_KEY=sk-abcdef0123456789abcdef0123456789";
    const findings = scanContent("x.env", content);
    expect(findings[0]?.line).toBe(3);
    expect(JSON.stringify(findings)).not.toContain("sk-abcdef");
  });
});

describe("assertFixtureValuesAreFake", () => {
  it("accepts real non-secret defaults and fake-marked secrets", () => {
    const content = [
      "APP_ENV=test",
      "NEXT_PUBLIC_APP_NAME=QuestCite",
      "NEXT_PUBLIC_SUPABASE_URL=https://fake-supabase-project.supabase.test",
      "EMAIL_DELIVERY_MODE=log",
      "DEMO_ORG_SLUG=northstar-cloud",
      "OPENAI_ANSWER_MODEL=gpt-5.6-luna",
      "OPENAI_API_KEY=fake-openai-key-for-tests",
      "AUDIT_HASH_SALT=fake-audit-hash-salt-0123456789abcdef",
      "# a comment = not an assignment",
      "EMPTY_SECRET=",
    ].join("\n");
    expect(assertFixtureValuesAreFake(content)).toEqual([]);
  });

  it("rejects secret-bearing values without a fake marker", () => {
    const findings = assertFixtureValuesAreFake([
      "OPENAI_API_KEY=sk-live-abcdef0123456789",
      "SUPABASE_SERVICE_ROLE_KEY=eyJreal.eyJreal.sigreal",
      "LEMON_SQUEEZY_WEBHOOK_SECRET=whsec_reallivevalue1234567890",
    ].join("\n"));
    expect(findings.length).toBe(3);
    expect(findings[0]?.pattern).toContain("OPENAI_API_KEY");
    expect(findings[2]?.pattern).toContain("LEMON_SQUEEZY_WEBHOOK_SECRET");
  });
});

describe("isPlaceholderValue", () => {
  it("recognizes the documented markers", () => {
    expect(isPlaceholderValue("fake-anon-key")).toBe(true);
    expect(isPlaceholderValue("EXAMPLE.COM")).toBe(true);
    expect(isPlaceholderValue("production-real-value")).toBe(false);
  });
});

describe("auditReleaseInventory", () => {
  it("passes a clean tree", () => {
    expect(
      auditReleaseInventory(["package.json", "src/app/page.tsx", ".env.example", ".env.test"]),
    ).toEqual([]);
  });

  it("blocks private notes and sales copy from releases", () => {
    const violations = auditReleaseInventory([
      "package.json",
      "memory/MEMORY.md",
      "memory/progress.md",
      "trustops-10-week-production-plan.md",
      "assets/sales/listing.md",
    ]);
    expect(violations.length).toBe(4);
    expect(violations.every((v) => v.kind === "forbidden-path")).toBe(true);
  });

  it("blocks real env files while allowing example/test fixtures", () => {
    const violations = auditReleaseInventory([".env", ".env.local", ".env.production", ".env.example", ".env.test"]);
    expect(violations.map((v) => v.path)).toEqual([".env", ".env.local", ".env.production"]);
    expect(violations.every((v) => v.kind === "env-file")).toBe(true);
  });
});

describe("filterReleaseFiles", () => {
  it("drops exactly the private paths the packaging rule defines (D005)", () => {
    const tracked = [
      "package.json",
      "memory/MEMORY.md",
      "memory/nested/deep-file.md",
      "trustops-10-week-production-plan.md",
      "assets/sales/listing.md",
      "src/app/page.tsx",
    ];
    expect(filterReleaseFiles(tracked)).toEqual(["package.json", "src/app/page.tsx"]);
  });

  it("composed with auditReleaseInventory, a tracked-memory repo audits clean", () => {
    const tracked = ["package.json", "memory/progress.md", "trustops-10-week-production-plan.md"];
    expect(auditReleaseInventory(filterReleaseFiles(tracked))).toEqual([]);
  });
});
