import { describe, expect, it } from "vitest";

import {
  accessRequestInputSchema,
  accessReviewSchema,
  certificationInputSchema,
  faqInputSchema,
  subprocessorInputSchema,
  trustBrandingSchema,
  trustDocumentInputSchema,
} from "@/lib/validation/trust-center";

const DOCUMENT_ID = "0b9c8a44-0000-4000-8000-000000000000";

describe("Trust Center editor validation", () => {
  it("trims branding, normalizes contact email, and converts optional blanks to null", () => {
    const result = trustBrandingSchema.safeParse({
      displayName: "  Acme Cloud  ",
      heroTitle: "  Security & Trust Center  ",
      heroSubtitle: "  ",
      overview: "  Encryption at rest and in transit, reviewed annually.  ",
      contactEmail: " SECURITY@ACME.EXAMPLE ",
      logoUrl: "  ",
      termsVersion: " v1 ",
      termsText: " Confidential documents are for evaluation only. ",
      requireEmailVerification: true,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.displayName).toBe("Acme Cloud");
      expect(result.data.heroSubtitle).toBeNull();
      expect(result.data.contactEmail).toBe("security@acme.example");
      expect(result.data.logoUrl).toBeNull();
      expect(result.data.termsVersion).toBe("v1");
      expect(result.data.requireEmailVerification).toBe(true);
    }
  });

  it("rejects short required content, invalid contact email, and non-HTTPS logos", () => {
    expect(
      trustBrandingSchema.safeParse({
        displayName: "Acme",
        heroTitle: "Trust",
        overview: "Too short",
        contactEmail: "not-an-email",
        logoUrl: "https://example.com/logo.svg",
        termsVersion: "v1",
        termsText: "These terms are long enough for the form.",
        requireEmailVerification: false,
      }).success,
    ).toBe(false);
    expect(
      trustBrandingSchema.safeParse({
        displayName: "Acme",
        heroTitle: "Trust",
        overview: "A sufficiently long security overview for this center.",
        contactEmail: "security@example.com",
        logoUrl: "http://example.com/logo.svg",
        termsVersion: "v1",
        termsText: "These terms are long enough for the form.",
        requireEmailVerification: false,
      }).success,
    ).toBe(false);
  });

  it("validates FAQs, certifications, subprocessors, and document cards", () => {
    expect(
      faqInputSchema.safeParse({ question: " Where? ", answer: " In the EU. ", visible: true }).data,
    ).toEqual({ question: "Where?", answer: "In the EU.", visible: true });
    expect(
      certificationInputSchema.safeParse({
        name: " SOC 2 ",
        status: "active",
        issuer: " ",
        validFrom: "2026-01-01",
        validUntil: "2027-01-01",
        demo: false,
        publiclyVisible: true,
      }).data,
    ).toMatchObject({ name: "SOC 2", issuer: null, status: "active" });
    expect(
      subprocessorInputSchema.safeParse({
        company: " Acme DB ",
        purpose: " Hosting ",
        dataCategory: " Customer content ",
        region: " EU ",
        publiclyVisible: true,
      }).success,
    ).toBe(true);
    expect(
      trustDocumentInputSchema.safeParse({
        documentId: DOCUMENT_ID,
        description: " Security overview ",
        publiclyRequestable: true,
      }).data,
    ).toEqual({ documentId: DOCUMENT_ID, description: "Security overview", publiclyRequestable: true });
  });

  it("rejects malformed editor content and dates", () => {
    expect(faqInputSchema.safeParse({ question: " ", answer: "answer", visible: true }).success).toBe(false);
    expect(
      certificationInputSchema.safeParse({
        name: "SOC 2",
        status: "unknown",
        issuer: "",
        validFrom: "2026/01/01",
        validUntil: "",
        demo: false,
        publiclyVisible: true,
      }).success,
    ).toBe(false);
    expect(
      subprocessorInputSchema.safeParse({
        company: "Company",
        purpose: "",
        dataCategory: "Data",
        region: "EU",
        publiclyVisible: true,
      }).success,
    ).toBe(false);
    expect(
      trustDocumentInputSchema.safeParse({ documentId: "not-a-uuid", description: "Card", publiclyRequestable: true }).success,
    ).toBe(false);
  });
});

describe("Trust Center prospect and review validation", () => {
  it("normalizes a valid access request and requires clickwrap plus a document", () => {
    const validRequest = {
      name: " Pat Prospect ",
      company: " Buyer Corp ",
      email: " PAT@BUYER.EXAMPLE ",
      documentIds: [DOCUMENT_ID],
      acceptTerms: true,
    };
    const result = accessRequestInputSchema.safeParse(validRequest);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        name: "Pat Prospect",
        company: "Buyer Corp",
        email: "pat@buyer.example",
        documentIds: [DOCUMENT_ID],
        acceptTerms: true,
      });
    }
    expect(accessRequestInputSchema.safeParse({ ...validRequest, acceptTerms: false }).success).toBe(false);
    expect(accessRequestInputSchema.safeParse({ ...validRequest, documentIds: [] }).success).toBe(false);
  });

  it("accepts valid approval and denial decisions, but rejects incomplete approval", () => {
    expect(
      accessReviewSchema.safeParse({ decision: "approved", documentIds: [DOCUMENT_ID], grantDays: 7 }).success,
    ).toBe(true);
    expect(
      accessReviewSchema.safeParse({ decision: "denied", documentIds: [], grantDays: 1 }).success,
    ).toBe(true);
    expect(
      accessReviewSchema.safeParse({ decision: "approved", documentIds: [], grantDays: 7 }).success,
    ).toBe(false);
    expect(
      accessReviewSchema.safeParse({ decision: "approved", documentIds: [DOCUMENT_ID], grantDays: 31 }).success,
    ).toBe(false);
  });
});
