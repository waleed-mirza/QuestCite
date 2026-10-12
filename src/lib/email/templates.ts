/**
 * Essential email templates (plan §W6): pure render functions — no I/O, no
 * provider. Every function takes org-controlled metadata only and returns a
 * subject + plain-text body. Inputs are truncated defensively so a long
 * title can never blow up a subject line.
 *
 * The question preview is the QUESTIONNAIRE's own question text (buyer-facing
 * content the org wrote), never document/answer content (rule 8).
 */

const SUBJECT_TITLE_MAX = 80;
const PREVIEW_MAX = 120;

function clip(value: string, max: number): string {
  const clean = value.replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

export type RenderedEmail = {
  /** Stable template key — what the transport logs instead of content. */
  templateKey: string;
  subject: string;
  text: string;
};

export function memberInviteEmail(input: {
  organizationName: string;
  inviterName: string;
  inviteUrl: string;
  expiresAt: Date;
}): RenderedEmail {
  const organization = clip(input.organizationName, SUBJECT_TITLE_MAX);
  const inviter = clip(input.inviterName, SUBJECT_TITLE_MAX);
  return {
    templateKey: "member.invite",
    subject: `You're invited to ${organization}`,
    text: [
      `${inviter} invited you to join ${organization} in QuestCite.`,
      "",
      `Open your invitation before ${input.expiresAt.toISOString().slice(0, 10)}:`,
      input.inviteUrl,
      "",
      "This invitation works once and requires the invited email to be signed in.",
    ].join("\n"),
  };
}

export function reviewReminderEmail(input: {
  questionnaireTitle: string;
  dueDate: string | null;
}): RenderedEmail {
  const title = clip(input.questionnaireTitle, SUBJECT_TITLE_MAX);
  return {
    templateKey: "review.reminder",
    subject: `Review reminder for "${title}"`,
    text: [
      `A review is still waiting in "${title}".`,
      input.dueDate === null ? "" : `The questionnaire is due ${input.dueDate}.`,
      "",
      "Open your workspace to finish the review.",
    ].join("\n"),
  };
}

export function questionnaireAssignedEmail(input: {
  questionnaireTitle: string;
  assignerName: string;
}): RenderedEmail {
  const title = clip(input.questionnaireTitle, SUBJECT_TITLE_MAX);
  return {
    templateKey: "questionnaire.assigned",
    subject: `You're the reviewer for "${title}"`,
    text: [
      `${input.assignerName} assigned you as reviewer for "${title}".`,
      "",
      "Open your workspace to start the review.",
    ].join("\n"),
  };
}

export function reviewRequestedEmail(input: {
  questionnaireTitle: string;
  questionPreview: string;
  actorName: string;
}): RenderedEmail {
  const title = clip(input.questionnaireTitle, SUBJECT_TITLE_MAX);
  const preview = clip(input.questionPreview, PREVIEW_MAX);
  return {
    templateKey: "answer.in_review",
    subject: `Answer ready for review in "${title}"`,
    text: [
      `${input.actorName} submitted an answer for review.`,
      "",
      `Question: ${preview}`,
      "",
      "Review it in your workspace.",
    ].join("\n"),
  };
}

export function changesRequestedEmail(input: {
  questionnaireTitle: string;
  questionPreview: string;
  actorName: string;
}): RenderedEmail {
  const title = clip(input.questionnaireTitle, SUBJECT_TITLE_MAX);
  const preview = clip(input.questionPreview, PREVIEW_MAX);
  return {
    templateKey: "answer.changes_requested",
    subject: `Changes requested on an answer in "${title}"`,
    text: [
      `${input.actorName} requested changes on an answer.`,
      "",
      `Question: ${preview}`,
      "",
      "Update the answer and resubmit it for review.",
    ].join("\n"),
  };
}

export function answerCommentedEmail(input: {
  questionnaireTitle: string;
  questionPreview: string;
  actorName: string;
}): RenderedEmail {
  const title = clip(input.questionnaireTitle, SUBJECT_TITLE_MAX);
  const preview = clip(input.questionPreview, PREVIEW_MAX);
  return {
    templateKey: "comment.added",
    subject: `New comment in "${title}"`,
    text: [
      `${input.actorName} commented on a question you're involved in.`,
      "",
      `Question: ${preview}`,
      "",
      "Read the discussion in your workspace.",
    ].join("\n"),
  };
}

export function questionnaireExportedEmail(input: {
  questionnaireTitle: string;
  exporterName: string;
  questionCount: number;
}): RenderedEmail {
  const title = clip(input.questionnaireTitle, SUBJECT_TITLE_MAX);
  return {
    templateKey: "questionnaire.exported",
    subject: `"${title}" was exported`,
    text: [
      `${input.exporterName} exported answers for ${input.questionCount} question${input.questionCount === 1 ? "" : "s"}.`,
      "",
      "The export is available in the questionnaire's export history.",
    ].join("\n"),
  };
}

// ---------------------------------------------------------------------------
// Week 7 — Trust Center access requests (plan §W7, journeys J8/J9)
// ---------------------------------------------------------------------------

/** Internal: tells owners/admins a request awaits review (no document names). */
export function trustAccessRequestReceivedEmail(input: {
  organizationName: string;
  documentCount: number;
}): RenderedEmail {
  const org = clip(input.organizationName, SUBJECT_TITLE_MAX);
  return {
    templateKey: "trust_access.requested",
    subject: `New document access request for ${org}`,
    text: [
      `Someone requested access to ${input.documentCount} document${input.documentCount === 1 ? "" : "s"}.`,
      "",
      "Open Access requests in your workspace to review it.",
    ].join("\n"),
  };
}

/** Prospect-facing confirmation for centers that require email verification. */
export function trustAccessVerificationEmail(input: {
  verificationUrl: string;
  expiresAt: Date;
}): RenderedEmail {
  const expires = input.expiresAt.toISOString().slice(0, 10);
  return {
    templateKey: "trust_access.verify",
    subject: "Confirm your document access request",
    text: [
      "We received your request for document access.",
      "",
      `Confirm your email before ${expires} to send the request to the review team:`,
      input.verificationUrl,
      "",
      "This link expires after 24 hours.",
    ].join("\n"),
  };
}

/**
 * Prospect-facing: approval with the gated link. The access URL is the raw
 * token bearer — it may live in an EMAIL BODY (delivery is the mechanism,
 * journey J9 step 3) but is never logged and never re-displayed anywhere
 * after this send.
 */
export function trustAccessApprovedEmail(input: {
  organizationName: string;
  accessUrl: string;
  expiresAt: Date;
}): RenderedEmail {
  const org = clip(input.organizationName, SUBJECT_TITLE_MAX);
  const expires = input.expiresAt.toISOString().slice(0, 10);
  return {
    templateKey: "trust_access.approved",
    subject: `Your document access request for ${org} was approved`,
    text: [
      "Good news — your request was approved.",
      "",
      `Open your documents (link valid until ${expires}):`,
      input.accessUrl,
      "",
      "Each download link inside is short-lived and for the granted documents only.",
    ].join("\n"),
  };
}

/** Prospect-facing denial. Deliberately generic: never names documents. */
export function trustAccessDeniedEmail(input: { organizationName: string }): RenderedEmail {
  const org = clip(input.organizationName, SUBJECT_TITLE_MAX);
  return {
    templateKey: "trust_access.denied",
    subject: `Your document access request for ${org}`,
    text: [
      "Thank you for your interest.",
      "",
      "We're not able to grant this request right now. If you believe this is a mistake, reply to this email or use the contact address on our Trust Center page.",
    ].join("\n"),
  };
}
