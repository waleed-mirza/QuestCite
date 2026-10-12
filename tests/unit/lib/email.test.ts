import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logCalls: Record<string, Array<{ message: string; context?: unknown }>> = {};

vi.mock("@/lib/observability/logger", () => ({
  logger: {
    debug: (message: string, context?: unknown) => {
      (logCalls.debug ??= []).push({ message, context });
    },
    info: (message: string, context?: unknown) => {
      (logCalls.info ??= []).push({ message, context });
    },
    warn: (message: string, context?: unknown) => {
      (logCalls.warn ??= []).push({ message, context });
    },
    error: (message: string, context?: unknown) => {
      (logCalls.error ??= []).push({ message, context });
    },
  },
}));

import {
  answerCommentedEmail,
  changesRequestedEmail,
  questionnaireAssignedEmail,
  questionnaireExportedEmail,
  reviewRequestedEmail,
  trustAccessApprovedEmail,
  trustAccessVerificationEmail,
  memberInviteEmail,
  reviewReminderEmail,
} from "@/lib/email/templates";
import { sendEmail, sendProspectEmail } from "@/lib/email/send";
import { resetServerEnvCache } from "@/lib/env";

/**
 * W6 email templates + the log-mode transport (plan §W6): templates render
 * from safe metadata; the transport logs ONLY ids + template keys, never
 * content (rule 8).
 */

beforeEach(() => {
  for (const key of Object.keys(logCalls)) {
    delete logCalls[key];
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetServerEnvCache();
});

describe("email templates", () => {
  it("renders each essential template with a stable key and plain text", () => {
    const assigned = questionnaireAssignedEmail({ questionnaireTitle: "SOC 2", assignerName: "Owner A" });
    expect(assigned.templateKey).toBe("questionnaire.assigned");
    expect(assigned.subject).toContain("SOC 2");
    expect(assigned.text).toContain("Owner A");

    const review = reviewRequestedEmail({
      questionnaireTitle: "SOC 2",
      questionPreview: "Is data encrypted at rest?",
      actorName: "Reviewer R",
    });
    expect(review.templateKey).toBe("answer.in_review");
    expect(review.text).toContain("Is data encrypted at rest?");

    const changes = changesRequestedEmail({
      questionnaireTitle: "SOC 2",
      questionPreview: "Backup rotation?",
      actorName: "Owner A",
    });
    expect(changes.templateKey).toBe("answer.changes_requested");

    const comment = answerCommentedEmail({
      questionnaireTitle: "SOC 2",
      questionPreview: "Subprocessors?",
      actorName: "Admin B",
    });
    expect(comment.templateKey).toBe("comment.added");

    const exported = questionnaireExportedEmail({
      questionnaireTitle: "SOC 2",
      exporterName: "Owner A",
      questionCount: 2,
    });
    expect(exported.templateKey).toBe("questionnaire.exported");
    expect(exported.text).toContain("2 questions");

    const verification = trustAccessVerificationEmail({
      verificationUrl: "https://trust.example/verify/verification-token",
      expiresAt: new Date("2026-09-05T00:00:00Z"),
    });
    expect(verification.templateKey).toBe("trust_access.verify");
    expect(verification.text).toContain("verification-token");

    const approved = trustAccessApprovedEmail({
      organizationName: "Acme Cloud",
      accessUrl: "/trust/acme/access/access-token",
      expiresAt: new Date("2026-09-05T00:00:00Z"),
    });
    expect(approved.templateKey).toBe("trust_access.approved");
    expect(approved.text).toContain("access-token");

    const invite = memberInviteEmail({
      organizationName: "Acme Cloud",
      inviterName: "Owner A",
      inviteUrl: "https://app.example/invite/one-time-token",
      expiresAt: new Date("2026-09-05T00:00:00Z"),
    });
    expect(invite.templateKey).toBe("member.invite");
    expect(invite.text).toContain("one-time-token");

    const reminder = reviewReminderEmail({ questionnaireTitle: "SOC 2", dueDate: "2026-09-20" });
    expect(reminder.templateKey).toBe("review.reminder");
    expect(reminder.text).toContain("2026-09-20");
  });

  it("singularizes a single question in the export email", () => {
    const exported = questionnaireExportedEmail({
      questionnaireTitle: "T",
      exporterName: "X",
      questionCount: 1,
    });
    expect(exported.text).toContain("1 question.");
  });

  it("strips control characters and truncates long titles/previews", () => {
    const rendered = reviewRequestedEmail({
      questionnaireTitle: `${"t".repeat(200)}\x00\nmore`,
      questionPreview: `${"q".repeat(300)}`,
      actorName: "A",
    });
    expect(rendered.subject.length).toBeLessThan(140);
    expect(rendered.subject).not.toMatch(/[\x00-\x1f\x7f]/);
    expect(rendered.text).toContain("…");
  });
});

describe("log-mode transport", () => {
  it("logs template key + user id only — never subject or body", async () => {
    const delivery = await sendEmail({
      templateKey: "answer.in_review",
      subject: "Answer ready for review in <Secret title>",
      text: "Secret body content",
      toUserId: "user-1",
      toEmail: "person@example.com",
      organizationId: "org-1",
    });
    expect(delivery).toBe("logged");
    const logged = JSON.stringify(logCalls.info ?? []);
    expect(logged).toContain("answer.in_review");
    expect(logged).toContain("user-1");
    expect(logged).not.toContain("Secret title");
    expect(logged).not.toContain("Secret body");
  });

  it("skips when the recipient has no address", async () => {
    const delivery = await sendEmail({
      templateKey: "comment.added",
      subject: "s",
      text: "b",
      toUserId: "user-2",
      toEmail: null,
      organizationId: "org-1",
    });
    expect(delivery).toBe("skipped");
    expect(logCalls.info).toBeUndefined();
  });

  it("logs a prospect template without the recipient address or bearer link", async () => {
    const verificationUrl = "https://trust.example/verify/bearer-token";
    const delivery = await sendProspectEmail({
      ...trustAccessVerificationEmail({
        verificationUrl,
        expiresAt: new Date("2026-09-05T00:00:00Z"),
      }),
      organizationId: "org-1",
      requestId: "request-1",
      toEmail: "prospect@example.com",
    });
    expect(delivery).toBe("logged");
    const logged = JSON.stringify(logCalls.info ?? []);
    expect(logged).toContain("trust_access.verify");
    expect(logged).toContain("request-1");
    expect(logged).not.toContain("prospect@example.com");
    expect(logged).not.toContain("bearer-token");
  });

  it("skips prospect delivery when no address is available", async () => {
    const delivery = await sendProspectEmail({
      templateKey: "trust_access.denied",
      subject: "subject",
      text: "body",
      organizationId: "org-1",
      requestId: "request-2",
      toEmail: null,
    });
    expect(delivery).toBe("skipped");
    expect(logCalls.info).toBeUndefined();
  });
});

describe("Resend transport", () => {
  it("sends rendered content to Resend without logging it", async () => {
    vi.stubEnv("APP_ENV", "test");
    vi.stubEnv("EMAIL_DELIVERY_MODE", "resend");
    vi.stubEnv("RESEND_API_KEY", "fixture-resend-key");
    vi.stubEnv("EMAIL_FROM", "noreply@example.com");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 200 }));

    const delivery = await sendEmail({
      templateKey: "member.invite",
      subject: "Private subject",
      text: "Private body",
      toUserId: "user-1",
      toEmail: "person@example.com",
      organizationId: "org-1",
    }, fetchMock);

    expect(delivery).toBe("sent");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init?.headers).toMatchObject({ Authorization: "Bearer fixture-resend-key" });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      from: "noreply@example.com",
      to: ["person@example.com"],
      subject: "Private subject",
      text: "Private body",
    });
    expect(JSON.stringify(logCalls)).not.toContain("Private body");
  });

  it("maps provider failures to a safe result", async () => {
    vi.stubEnv("APP_ENV", "test");
    vi.stubEnv("EMAIL_DELIVERY_MODE", "resend");
    vi.stubEnv("RESEND_API_KEY", "fixture-resend-key");
    vi.stubEnv("EMAIL_FROM", "noreply@example.com");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("provider details", { status: 500 }));

    await expect(sendEmail({
      templateKey: "review.reminder",
      subject: "s",
      text: "b",
      toUserId: "user-1",
      toEmail: "person@example.com",
      organizationId: "org-1",
    }, fetchMock)).resolves.toBe("failed");
  });
});
