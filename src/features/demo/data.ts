/**
 * Client-safe Northstar Cloud demo fixture (plan §15).
 *
 * This module contains fictional content only. It is deliberately free of
 * Supabase, provider, filesystem, and server-only imports so the same
 * contract can drive the signed-out demo, the seed script, and unit tests.
 */

export const DEMO_ORG_SLUG = "northstar-cloud";
export const DEMO_ORG_NAME = "Northstar Cloud";
export const DEMO_DISCLAIMER = "SAMPLE DATA — NOT LEGAL OR COMPLIANCE ADVICE.";
export const DEMO_QUESTIONNAIRE_TITLE = "Northstar Cloud 2026 Security Assessment";
export const DEMO_QUESTIONNAIRE_SHEET = "Security Assessment";

export type DemoDocumentKey =
  | "security-overview"
  | "access-control"
  | "encryption"
  | "incident-response"
  | "backup-recovery"
  | "data-retention"
  | "subprocessors";

export type DemoDocument = {
  readonly key: DemoDocumentKey;
  readonly title: string;
  readonly category: string;
  readonly filename: `${DemoDocumentKey}.md`;
  readonly description: string;
};

export const DEMO_DOCUMENTS: readonly DemoDocument[] = [
  {
    key: "security-overview",
    title: "Security Overview",
    category: "security",
    filename: "security-overview.md",
    description: "Program scope, governance, and the control framework used by Northstar Cloud.",
  },
  {
    key: "access-control",
    title: "Access Control Standard",
    category: "access",
    filename: "access-control.md",
    description: "Identity, privileged access, MFA, joiner-mover-leaver, and quarterly review practices.",
  },
  {
    key: "encryption",
    title: "Encryption Standard",
    category: "encryption",
    filename: "encryption.md",
    description: "Encryption at rest and in transit, key ownership, rotation, and secret handling.",
  },
  {
    key: "incident-response",
    title: "Incident Response Plan",
    category: "incident response",
    filename: "incident-response.md",
    description: "Detection, triage, escalation, communications, and post-incident review.",
  },
  {
    key: "backup-recovery",
    title: "Backup and Recovery Standard",
    category: "resilience",
    filename: "backup-recovery.md",
    description: "Backup cadence, recovery objectives, restore testing, and regional resilience.",
  },
  {
    key: "data-retention",
    title: "Data Retention Schedule",
    category: "privacy",
    filename: "data-retention.md",
    description: "Retention periods, deletion requests, legal holds, and workspace configuration.",
  },
  {
    key: "subprocessors",
    title: "Subprocessor List",
    category: "privacy",
    filename: "subprocessors.md",
    description: "Fictional subprocessor register with purpose, data category, and processing region.",
  },
] as const;

export type DemoKnowledgeEntry = {
  readonly key: string;
  readonly question: string;
  readonly answer: string;
  readonly category: string;
  readonly sourceKey: DemoDocumentKey;
};

export const DEMO_KNOWLEDGE_ENTRIES: readonly DemoKnowledgeEntry[] = [
  {
    key: "security-program",
    question: "Do you maintain a formal information security program?",
    answer: "Yes. Northstar Cloud maintains a documented security program with assigned control owners, annual policy review, and management oversight.",
    category: "security",
    sourceKey: "security-overview",
  },
  {
    key: "mfa",
    question: "Is multi-factor authentication required for privileged access?",
    answer: "Yes. MFA is required for workforce accounts and all privileged access paths.",
    category: "access",
    sourceKey: "access-control",
  },
  {
    key: "access-review",
    question: "How often are privileged accounts reviewed?",
    answer: "Privileged access is reviewed at least quarterly and when a role changes or a worker leaves.",
    category: "access",
    sourceKey: "access-control",
  },
  {
    key: "encryption-at-rest",
    question: "Is customer data encrypted at rest?",
    answer: "Yes. Customer data is encrypted at rest using managed AES-256 encryption controls.",
    category: "encryption",
    sourceKey: "encryption",
  },
  {
    key: "encryption-transit",
    question: "Is customer data encrypted in transit?",
    answer: "Yes. External connections require TLS 1.2 or later, with TLS 1.3 preferred where supported.",
    category: "encryption",
    sourceKey: "encryption",
  },
  {
    key: "incident-notification",
    question: "Do you maintain an incident response plan?",
    answer: "Yes. The incident response plan defines severity, escalation, evidence preservation, communications, and post-incident review.",
    category: "incident response",
    sourceKey: "incident-response",
  },
  {
    key: "backup-cadence",
    question: "How frequently are production backups taken?",
    answer: "Production data is backed up daily, with recovery points monitored against the documented resilience objectives.",
    category: "resilience",
    sourceKey: "backup-recovery",
  },
  {
    key: "retention-control",
    question: "Can workspace administrators configure retention?",
    answer: "Yes. Workspace owners and admins can choose a documented retention period and request metadata-only export or deletion.",
    category: "privacy",
    sourceKey: "data-retention",
  },
  {
    key: "subprocessor-register",
    question: "Do you maintain a subprocessor register?",
    answer: "Yes. The fictional demo register identifies each subprocessor's purpose, data category, and processing region.",
    category: "privacy",
    sourceKey: "subprocessors",
  },
  {
    key: "security-contact",
    question: "How can a customer report a security concern?",
    answer: "Customers can use the security contact published on the Trust Center. Reports are triaged through the incident response process.",
    category: "security",
    sourceKey: "security-overview",
  },
] as const;

type GroundedQuestionSeed = {
  readonly key: string;
  readonly question: string;
  readonly category: string;
  readonly sourceKey: DemoDocumentKey;
  readonly answer: string;
};

const GROUNDED_QUESTION_SEEDS: readonly GroundedQuestionSeed[] = [
  {
    key: "sec-01",
    question: "Do you maintain a formal information security program?",
    category: "security",
    sourceKey: "security-overview",
    answer: "Yes. Northstar Cloud maintains a documented information security program with named owners and annual policy review.",
  },
  {
    key: "sec-02",
    question: "Are security policies reviewed on a defined schedule?",
    category: "security",
    sourceKey: "security-overview",
    answer: "Yes. Core security policies are reviewed at least annually and after material changes to the service or threat environment.",
  },
  {
    key: "sec-03",
    question: "Is there a designated owner for security governance?",
    category: "security",
    sourceKey: "security-overview",
    answer: "Yes. Security governance has a designated owner who coordinates control owners, risk review, and remediation tracking.",
  },
  {
    key: "sec-04",
    question: "Do you perform risk assessments for material changes?",
    category: "security",
    sourceKey: "security-overview",
    answer: "Material product and infrastructure changes receive a documented risk review before release.",
  },
  {
    key: "sec-06",
    question: "Do you track remediation work to closure?",
    category: "security",
    sourceKey: "security-overview",
    answer: "Yes. Findings are assigned, prioritized, and tracked through closure with evidence of the completed action.",
  },
  {
    key: "access-01",
    question: "Is MFA required for workforce accounts?",
    category: "access",
    sourceKey: "access-control",
    answer: "Yes. Multi-factor authentication is required for workforce accounts and privileged access.",
  },
  {
    key: "access-02",
    question: "Are privileged accounts separated from standard user accounts?",
    category: "access",
    sourceKey: "access-control",
    answer: "Yes. Privileged operations use separate elevated access paths with stronger authentication and monitoring.",
  },
  {
    key: "access-03",
    question: "Are access rights based on job responsibilities?",
    category: "access",
    sourceKey: "access-control",
    answer: "Yes. Access is granted according to role responsibilities and the least-privilege standard.",
  },
  {
    key: "access-04",
    question: "Do you remove access when a worker leaves?",
    category: "access",
    sourceKey: "access-control",
    answer: "Yes. Offboarding includes prompt account disablement and removal of active privileged sessions where supported.",
  },
  {
    key: "access-05",
    question: "How often are privileged accounts recertified?",
    category: "access",
    sourceKey: "access-control",
    answer: "Privileged access is recertified quarterly and after material role changes.",
  },
  {
    key: "crypto-01",
    question: "Is customer data encrypted at rest?",
    category: "encryption",
    sourceKey: "encryption",
    answer: "Yes. Customer data is encrypted at rest using managed AES-256 encryption controls.",
  },
  {
    key: "crypto-02",
    question: "Is customer data encrypted in transit?",
    category: "encryption",
    sourceKey: "encryption",
    answer: "Yes. External connections require TLS 1.2 or later, with TLS 1.3 preferred where supported.",
  },
  {
    key: "crypto-03",
    question: "Are encryption keys managed separately from application data?",
    category: "encryption",
    sourceKey: "encryption",
    answer: "Yes. Encryption keys are managed by the infrastructure layer and are not stored alongside customer content.",
  },
  {
    key: "crypto-04",
    question: "Are secrets excluded from source control?",
    category: "encryption",
    sourceKey: "encryption",
    answer: "Yes. Provider keys and signing material are environment-only and are checked by the release secret scan.",
  },
  {
    key: "crypto-05",
    question: "Are cryptographic configurations reviewed periodically?",
    category: "encryption",
    sourceKey: "encryption",
    answer: "Cryptographic configuration is reviewed during security maintenance and material infrastructure changes.",
  },
  {
    key: "ir-01",
    question: "Do you maintain a documented incident response plan?",
    category: "incident response",
    sourceKey: "incident-response",
    answer: "Yes. The plan defines detection, triage, severity, escalation, communications, and post-incident review.",
  },
  {
    key: "ir-02",
    question: "Are incidents assigned a severity and owner?",
    category: "incident response",
    sourceKey: "incident-response",
    answer: "Yes. Each incident receives a severity, an accountable owner, and a documented response timeline.",
  },
  {
    key: "ir-03",
    question: "Do you preserve evidence during incident response?",
    category: "incident response",
    sourceKey: "incident-response",
    answer: "Yes. Responders preserve relevant logs and evidence while avoiding exposure of customer content.",
  },
  {
    key: "ir-04",
    question: "Do you review incidents after containment?",
    category: "incident response",
    sourceKey: "incident-response",
    answer: "Yes. Material incidents receive a post-incident review with root cause, actions, and assigned follow-up.",
  },
  {
    key: "backup-01",
    question: "How frequently are production backups taken?",
    category: "resilience",
    sourceKey: "backup-recovery",
    answer: "Production data is backed up daily, with recovery points monitored against resilience objectives.",
  },
  {
    key: "backup-02",
    question: "Are backups stored separately from the primary data path?",
    category: "resilience",
    sourceKey: "backup-recovery",
    answer: "Yes. Backup copies are isolated from the primary application path and access is restricted.",
  },
  {
    key: "backup-03",
    question: "Do you test restoration from backup?",
    category: "resilience",
    sourceKey: "backup-recovery",
    answer: "Yes. Restore exercises are scheduled and record whether recovery objectives were met.",
  },
  {
    key: "backup-04",
    question: "Are recovery objectives documented?",
    category: "resilience",
    sourceKey: "backup-recovery",
    answer: "Yes. Recovery point and recovery time objectives are documented for the production service.",
  },
  {
    key: "backup-05",
    question: "Is access to backup data restricted?",
    category: "resilience",
    sourceKey: "backup-recovery",
    answer: "Yes. Backup access is limited to authorized operators and is recorded for audit review.",
  },
  {
    key: "retention-01",
    question: "Are retention periods documented by data category?",
    category: "privacy",
    sourceKey: "data-retention",
    answer: "Yes. The retention schedule documents periods for account, audit, questionnaire, and uploaded document metadata.",
  },
  {
    key: "retention-02",
    question: "Can an organization request deletion of its workspace data?",
    category: "privacy",
    sourceKey: "data-retention",
    answer: "Yes. An owner can start a confirmed deletion workflow; the application records the request before purge.",
  },
  {
    key: "retention-03",
    question: "Can workspace administrators configure retention?",
    category: "privacy",
    sourceKey: "data-retention",
    answer: "Yes. Owners and admins can choose a retention period within the configured bounds.",
  },
  {
    key: "retention-04",
    question: "Do you support a metadata-only export before deletion?",
    category: "privacy",
    sourceKey: "data-retention",
    answer: "Yes. The owner-only export contains safe workspace metadata and does not include document contents or signed URLs.",
  },
  {
    key: "sub-01",
    question: "Do you publish the purpose of each subprocessor?",
    category: "privacy",
    sourceKey: "subprocessors",
    answer: "Yes. The demo register publishes each fictional subprocessor's purpose and data category.",
  },
  {
    key: "sub-02",
    question: "Do you identify the processing region for subprocessors?",
    category: "privacy",
    sourceKey: "subprocessors",
    answer: "Yes. Each demo subprocessor entry includes a processing region.",
  },
  {
    key: "sub-03",
    question: "Are subprocessor records reviewed when vendors change?",
    category: "privacy",
    sourceKey: "subprocessors",
    answer: "Yes. The register is reviewed when a vendor or processing purpose changes.",
  },
  {
    key: "sub-04",
    question: "Can customers request the current subprocessor list?",
    category: "privacy",
    sourceKey: "subprocessors",
    answer: "Yes. The current fictional list is published in the demo Trust Center.",
  },
] as const;

type ReviewQuestionSeed = {
  readonly key: string;
  readonly question: string;
  readonly category: string;
  readonly sourceKey: DemoDocumentKey;
  readonly answer: string;
  readonly reviewNote: string;
};

const REVIEW_QUESTION_SEEDS: readonly ReviewQuestionSeed[] = [
  {
    key: "review-01",
    question: "Do you maintain a current penetration-test report?",
    category: "assurance",
    sourceKey: "security-overview",
    answer: "A testing program is described, but the current report is shared only through the documented review process.",
    reviewNote: "Confirm the current report date and approved sharing path before sending externally.",
  },
  {
    key: "review-02",
    question: "What is the maximum time to notify customers after a confirmed incident?",
    category: "incident response",
    sourceKey: "incident-response",
    answer: "The incident plan defines customer communication criteria and escalation, but this fixture does not set a contractual deadline.",
    reviewNote: "Legal or customer-success review required for a contractual notification SLA.",
  },
  {
    key: "review-03",
    question: "Do you support customer-managed encryption keys?",
    category: "encryption",
    sourceKey: "encryption",
    answer: "Managed encryption is documented; customer-managed key support is not confirmed in this sample evidence.",
    reviewNote: "Do not infer customer-managed key support from the at-rest encryption control.",
  },
  {
    key: "review-04",
    question: "What are the exact recovery time objectives for every service tier?",
    category: "resilience",
    sourceKey: "backup-recovery",
    answer: "Recovery objectives are documented at a service level, but tier-specific values require an owner to confirm.",
    reviewNote: "Confirm the service tier and current RTO before exporting this answer.",
  },
  {
    key: "review-05",
    question: "Do you provide a dedicated data residency option?",
    category: "privacy",
    sourceKey: "data-retention",
    answer: "Processing regions are documented for the sample environment; a dedicated residency option is not established here.",
    reviewNote: "Confirm the deployment's actual region and contract terms.",
  },
  {
    key: "review-06",
    question: "Is annual security training completion independently certified?",
    category: "security",
    sourceKey: "access-control",
    answer: "Security responsibilities and access controls are documented; independent training certification is not included.",
    reviewNote: "Attach approved training evidence or answer manually.",
  },
] as const;

type InsufficientQuestionSeed = {
  readonly key: string;
  readonly question: string;
  readonly category: string;
};

const INSUFFICIENT_QUESTION_SEEDS: readonly InsufficientQuestionSeed[] = [
  {
    key: "insufficient-01",
    question: "Do you hold a current government security authorization?",
    category: "assurance",
  },
  {
    key: "insufficient-02",
    question: "What is the exact contractual subprocessor objection window?",
    category: "privacy",
  },
] as const;

export type DemoQuestionDisposition = "answered" | "needs_review" | "insufficient_evidence";
export type DemoQuestionStatus = "drafted" | "insufficient_evidence";

export type DemoQuestion = {
  readonly key: string;
  readonly question: string;
  readonly category: string;
  readonly sourceKey: DemoDocumentKey | null;
  readonly answer: string;
  readonly disposition: DemoQuestionDisposition;
  readonly status: DemoQuestionStatus;
  readonly evidenceStrength: "high" | "medium" | "low" | "insufficient";
  readonly reviewNote: string | null;
};

export const DEMO_QUESTIONS: readonly DemoQuestion[] = [
  ...GROUNDED_QUESTION_SEEDS.map((question) => ({
    ...question,
    disposition: "answered" as const,
    status: "drafted" as const,
    evidenceStrength: "high" as const,
    reviewNote: null,
  })),
  ...REVIEW_QUESTION_SEEDS.map((question) => ({
    ...question,
    disposition: "needs_review" as const,
    status: "drafted" as const,
    evidenceStrength: "low" as const,
  })),
  ...INSUFFICIENT_QUESTION_SEEDS.map((question) => ({
    ...question,
    sourceKey: null,
    answer: "",
    disposition: "insufficient_evidence" as const,
    status: "insufficient_evidence" as const,
    evidenceStrength: "insufficient" as const,
    reviewNote: null,
  })),
] as const;

export type DemoStats = {
  readonly totalQuestions: number;
  readonly groundedDrafts: number;
  readonly needsReview: number;
  readonly insufficientEvidence: number;
  readonly citedDrafts: number;
};

export function summarizeDemoQuestions(questions: readonly DemoQuestion[] = DEMO_QUESTIONS): DemoStats {
  return {
    totalQuestions: questions.length,
    groundedDrafts: questions.filter((question) => question.disposition === "answered").length,
    needsReview: questions.filter((question) => question.disposition === "needs_review").length,
    insufficientEvidence: questions.filter((question) => question.disposition === "insufficient_evidence").length,
    citedDrafts: questions.filter((question) => question.sourceKey !== null).length,
  };
}

export const DEMO_RUN_STEPS = [
  "Loading approved evidence",
  "Drafting grounded responses",
  "Validating citations",
  "Building the review queue",
] as const;

export type DemoAction =
  | "view"
  | "filter"
  | "simulate_edit"
  | "replay_answers"
  | "download_sample"
  | "upload"
  | "invite"
  | "checkout"
  | "delete_workspace"
  | "live_ai";

export type DemoActionAvailability = {
  readonly allowed: boolean;
  readonly message: string;
};

const DEMO_DISABLED_ACTION_MESSAGE =
  "Disabled in the public demo. The source template includes the real implementation.";

export function demoActionAvailability(action: DemoAction): DemoActionAvailability {
  if (action === "view" || action === "filter" || action === "simulate_edit" || action === "replay_answers" || action === "download_sample") {
    return { allowed: true, message: "Available in the fictional read-only demo." };
  }
  return { allowed: false, message: DEMO_DISABLED_ACTION_MESSAGE };
}

export const DEMO_DISABLED_OPERATIONS = [
  { action: "upload" as const, label: "Upload a document" },
  { action: "invite" as const, label: "Invite a teammate" },
  { action: "checkout" as const, label: "Open checkout" },
  { action: "delete_workspace" as const, label: "Delete workspace" },
] as const;
