# QuestCite — Ten Critical User Journeys (v1)

Source: plan §17 (E2E must cover signup, organization onboarding, upload, import, draft, review, export, Trust Center request, billing) and §18 week gates. These ten journeys are the E2E coverage contract.
Conventions: "DB" = state that must be true in PostgreSQL after the journey.
The resolved decisions below are the v1 behavior contract; historical week labels
are retained only for traceability.

---

## J1. Signup → email verification → onboarding → workspace creation

**Actor/Preconditions:** anonymous visitor with a work email; no existing account; email delivery configured (or `EMAIL_DELIVERY_MODE=log` in dev).
1. Visitor opens `/signup` (plan §13 route; not yet scaffolded — W2) and submits email + password.
2. Supabase Auth creates the user and sends a verification email.
3. Visitor clicks the verification link → `/auth/callback` → session established; redirected to onboarding.
4. Onboarding: user enters organization name; slug is derived and editable.
5. Submit → server calls `create_organization_with_owner(name, slug)` — one atomic RPC/transaction.
6. Redirect to `/app/{orgSlug}` (dashboard).

**Postconditions:** user signed in; lands in their new workspace as Owner.
**DB:** `profiles` row keyed to `auth.users.id`; `organizations` row (name, slug, status); `organization_members` (role=owner, unique org+user); default `trust_centers`/settings created; audit event for the member action. No ownerless organization can exist even on failure (plan §7).
**Failure paths:** expired/reused verification link → clear error + resend; email already registered → route to login; slug collision/reserved slug (`trust`, `demo`, `admin`, `northstar-cloud`) → validation error (D017); transaction failure → full rollback, nothing partially created (plan §7); email provider failure → user can resend; a verified user without a workspace returns through `/onboarding`, while an existing member is routed to their oldest workspace (D018).

## J2. Invite a team member → accept invitation → role assignment

**Actor/Preconditions:** Owner or Admin of an existing organization; invitee email not already a member; invitee has no session requirement.
1. Owner opens Members → "Invite member", enters email + role (admin/reviewer/viewer).
2. Server stores only the SHA-256 hash of the invitation token and sends the raw token as a one-time link.
3. Invitee opens the link; the app shows organization name, inviter, and the role being granted.
4. Accept → `accept_organization_invite(raw_token)` verifies email match, expiry, unused state, and organization status.
5. Membership created and invitation marked accepted in one transaction; invitee redirected into the workspace.
6. Owner (or Admin) can later change the member's role from Members.

**Postconditions:** invitee is a member with the granted role; invitation consumed.
**DB:** `organization_invites` (hashed token, email, role, inviter, expiry, accepted_at); `organization_members` (unique org+user); audit event for the member/role action.
**Failure paths:** expired link, reused token, wrong email, or deactivated organization → reject with a safe message (plan §7, W2 tests); invitee already a member → reject; Admin attempting to invite an Owner or elevate self → rejected server-side and by RLS (plan §7); removing the final owner → prevented (plan §7); email delivery failure → resend path.

## J3. Upload knowledge document → processing → visible in knowledge base

**Actor/Preconditions:** Owner/Admin (`upload and manage evidence`); plan upload quota available; file is text-based PDF/DOCX/TXT/Markdown ≤ 10 MB (template default).
1. Owner opens Knowledge base → Upload and selects a file.
2. Client requests an upload intent; server verifies organization role, plan quota, file extension, claimed MIME, and size.
3. File uploads directly to the private bucket at `{org}/{doc}/{version}/{sanitized_filename}`.
4. Server validates magic bytes, checksum, and supported type.
5. Parser extracts text locally; text normalized preserving headings and page/section references.
6. Text split into ~600–900 token chunks with modest overlap; embeddings generated in batches into `document_chunks`.
7. Document marked `ready`; it appears in the knowledge list and is searchable.

**Postconditions:** document and current version visible; chunks searchable in-tenant.
**DB:** `documents` (title, category, owner, review date, state); `document_versions` (storage path, MIME, size, checksum, parser version, processing state); `document_chunks` with embeddings; storage object present and private.
**Failure paths:** unsupported input (scanned-only PDF, encrypted, `.doc`/`.xls`/`.xlsm`, archives, executables, >10 MB, misleading extension) → rejected before/at validation with a safe message (plan §9, W3 tests); magic bytes ≠ claimed MIME → reject; parser failure → stored as a safe processing error, no server paths or content in logs; quota exceeded → plan-limit message; embedding API failure → capped retries then visible error; an interrupted upload remains an `importing` record for owner/admin cleanup, and the delete action removes its tracked storage objects before re-import.

## J4. Import questionnaire (.xlsx) → question detection → review import mapping

**Actor/Preconditions:** Owner/Admin/Reviewer (plan §4); `.xlsx` or `.csv`; organization within its questionnaire quota for the period.
1. Owner opens Questionnaires → Import and uploads the customer file.
2. Server stores the untouched original workbook and records its checksum + parser version.
3. Server reads workbook metadata and candidate sheets with ExcelJS (or CSV metadata).
4. Server detects likely question, answer, and notes columns and shows a mapping preview.
5. User reviews/overrides sheet selection and column mapping — detection is never silently trusted (plan §9).
6. User confirms → each question is persisted with its original sheet, row, and cell coordinates.
7. Questionnaire becomes `active` in the list with progress at 0.

**Postconditions:** questionnaire and questions exist; original file unchanged; mapping recorded.
**DB:** `questionnaires` (customer, title, status, due date, progress, assigned reviewer); `questionnaire_files` (original path, file type, checksum, parser version); `questions` (normalized text, source sheet/row/cell, answer cell, category, status, assignee).
**Failure paths:** `.xls`/`.xlsm`/password-protected/macro workbook → rejected with the documented reason (plan §3, §9); empty sheet or zero questions detected → mapping screen shows an empty preview with abort; merged headings/odd column names/unicode/large cells/duplicate questions → detection may err, user override required (W4 fixture matrix); unsupported workbook features → warning surfaced; quota exceeded → blocked with upgrade prompt. Duplicate question text is kept as separate rows; source-cell uniqueness, not text deduplication, defines identity.

## J5. Generate AI draft for a question → citation attached → status changes

**Actor/Preconditions:** Owner/Admin/Reviewer; question in an `active` questionnaire; organization AI quota remaining; AI kill switches off; some evidence exists in-tenant.
1. Reviewer opens the question and clicks "Generate draft" (or selects several questions for a batch).
2. `POST /api/questionnaires/{id}/runs` creates an `answer_run` and pending question work items; quota consumed atomically.
3. Browser-driven resumable batches call `POST /api/answer-runs/{id}/next`, which claims a small batch transactionally.
4. For each question: normalize/categorize → one query embedding → hybrid search restricted to the current organization's chunks and approved knowledge entries → 4–8 evidence chunks selected.
5. Model returns structured JSON (answer, disposition, citation_ids, review_note).
6. Server validates: every citation ID was in the retrieved evidence and belongs to the current organization; empty/invalid citations force `needs_review`/`insufficient_evidence`; unsupported compliance claims rejected.
7. Evidence strength computed (High/Medium/Low/Insufficient) and stored; answer saved with citations; status shows as needing review; the question-level evidence drawer shows the exact supporting excerpts.

**Postconditions:** draft visible with citations and strength label; nothing is auto-approved.
**DB:** `answer_runs` (model, prompt version, status, usage, error, started/completed); `answers` (draft text, workflow status, evidence strength, creator type=ai); `answer_citations` (source type, source record/chunk, excerpt hash, retrieval score); `usage_counters` incremented atomically.
**Failure paths:** model cites non-retrieved or out-of-tenant evidence → invalid citations dropped, answer forced to needs_review/insufficient (plan §10, W5 tests); no suitable evidence → abstain (`insufficient_evidence`), never fabricate; adversarial instructions inside evidence → ignored (prompt-injection defenses); API timeout/partial completion → capped retries, visible per-item error, run resumable after refresh; duplicate request → idempotency keys prevent duplicate answers or double quota consumption (plan §11); quota exhausted → run blocked with upgrade prompt.

## J6. Reviewer approves/edits/rejects an answer → audit trail entry

**Actor/Preconditions:** Reviewer/Admin/Owner (approve permission); answer in a reviewable state (`drafted`/`in_review`); assignee or unassigned queue.
1. Reviewer opens their review queue and selects the question.
2. Reviewer reads the draft and opens the evidence drawer to check each citation.
3. Reviewer edits the answer inline — each edit creates a version-history entry.
4. Reviewer may add a threaded comment on the question or answer.
5. Reviewer clicks Approve, Request changes, or Reject.
6. The state machine validates the transition (invalid transitions fail); approval records `approved_by`/`approved_at`.
7. Audit event written; assignee receives an in-app notification (and email per plan §18 W8 templates).

**Postconditions:** answer in `approved`/`changes_requested`/`rejected`; history and audit present.
**DB:** `answers` (current text, workflow status, approved_by, approved_at); answer version history (compare view); `comments`; `review_tasks` (assignee, state, due date, resolution); `audit_events`; `notifications`.
**Failure paths:** invalid transition (e.g., approving an `insufficient_evidence` answer) → state machine rejects with a clear error; simultaneous edit+approve race → conflict detection and one deterministic winner (W6 tests); Viewer attempts any review action → permission denied; cross-tenant question ID → RLS denial; Viewer/Reviewer escalation attempts logged. Human authors may approve their own drafts (D022); the AI path can never approve.

## J7. Export completed questionnaire → original workbook preserved

**Actor/Preconditions:** Owner/Admin/Reviewer; questionnaire imported with a valid original file and mapping; answers reviewed or deliberately blank by choice. Completion is required before export; unresolved drafts block completion, while conscious blanks and insufficient-evidence answers export as empty cells (D021/D023).
1. Owner opens the questionnaire → Export → chooses `.xlsx` or `.csv` and optionally the generated summary sheet.
2. Server loads the untouched original file and verifies mapped cells still match expectations.
3. Server writes only into mapped answer cells; the source file is never overwritten.
4. Server reopens the exported workbook and verifies formulas, unrelated cell values, sheet order, merges, and representative formatting are intact (fixture-backed check).
5. Exported file stored as a new version with checksum; export history entry created.
6. Owner downloads via a short-lived signed URL; audit event written.

**Postconditions:** completed file available for download; original untouched; export recorded.
**DB:** `questionnaire_files` (exported path + checksum alongside original), export history, `audit_events` (export action).
**Failure paths:** mappings no longer match expected cells → export refused with reason (plan §9); original missing/corrupt in storage → error, no partial file; macros/unsupported advanced Excel features → documented warning, not silent corruption; signed URL expired → re-request; cross-tenant export attempt → RLS denial.

## J8. Anonymous buyer visits public Trust Center → views documents → submits access request

**Actor/Preconditions:** signed-out prospect; Trust Center published at `/trust/{slug}`; at least one gated document marked publicly requestable; clickwrap terms configured.
1. Prospect opens `/trust/northstar-cloud` (any published tenant slug).
2. Page renders hero, security overview, certifications (marked "Demo" in the demo), subprocessors, FAQ, and document cards — only explicitly published, allowlisted fields.
3. Prospect clicks "Request access" on a gated document card.
4. Form requests name, company, work email, and requested documents.
5. Prospect accepts the displayed clickwrap terms (version + terms hash recorded).
6. Submit → server creates the access request, rate-limited atomically; when the center requires confirmation, the server creates a 24-hour signed verification link through the log-safe email abstraction.
7. Prospect sees either a confirmation-needed or submitted state; after confirmation the request enters review. The organization's Owner/Admin sees only reviewable requests under Access requests.

**Postconditions:** request visible internally; no document access granted yet.
**DB:** `access_requests` (prospect identity, company, requested files, state, expiry); `nda_acceptances` (version, displayed-terms hash, identity, timestamp, IP hash); no `document_access_grants` rows yet.
**Failure paths:** unpublished/unknown slug → 404 (no existence leak); draft/archived/internal/expired/replaced documents never listed (W7 tests); invalid email/missing consent → validation errors; duplicate or spam requests → atomic rate limiting; stored XSS in name/FAQ/description/filename → escaped output with tests (plan §18 W7); email sending disabled (demo) → the request remains in the database and log mode records no address, body, or bearer link.

## J9. Owner handles the access request (approve/deny) → requester notified

**Actor/Preconditions:** Owner/Admin; an existing `pending_review` access request. W7 resolution: only Owner and Admin can view or handle the queue.
1. Owner opens Access requests and reviews requester identity, company, requested documents, and terms acceptance.
2. Owner approves and selects which documents to grant, and sets a grant expiry; or denies.
3. On approval: one `document_access_grants` row per document with expiry; request state → approved; the log-safe prospect email abstraction is invoked without logging the address, body, or bearer link.
4. Prospect accepts current terms if needed, then downloads via a short-lived signed URL.
5. Each download writes a `download_events` row (document/version, grant, timestamp, IP hash, user-agent summary).
6. Audit event written for the approval/denial.

**Postconditions:** request resolved; grants and download trail exist; requester informed either way.
**DB:** `access_requests` (state, expiry); `document_access_grants` (request↔document, grant expiry); `notifications`; `download_events`; `audit_events`.
**Failure paths:** grant reuse across documents or organizations → prevented and tested (plan §18 W7); expired grant/link → download fails with a re-request path; grants remain document-bound and use the latest ready version, while an archived/removed document follows the same generic denial path; denial must not leak which documents exist; request expiry → terminal; email delivery failure → the in-app notification remains the record.

## J10. Plan limits: owner upgrades through checkout → webhook → entitlement change

**Actor/Preconditions:** Owner (billing; Admin optional if configured); organization at a limit (e.g., Trial's 25 AI-drafted answers or 1 questionnaire).
1. Reviewer hits the limit mid-work → blocked action shows a plan-limit message and upgrade prompt.
2. Owner opens Billing → plan comparison rendered from `src/config/plans.ts`.
3. Owner clicks Upgrade → server creates the checkout with the organization ID as validated custom data; plan identifiers from the browser are never trusted.
4. Owner completes hosted checkout (test mode during development).
5. The provider sends a signed webhook → server verifies the raw body against `X-Signature` with constant-time comparison.
6. Event saved idempotently in `billing_webhook_events`; local subscription updated in a short transaction; HTTP 200 returned immediately.
7. Entitlements recomputed from the local subscription; the previously blocked action now succeeds; portal/update-payment links available on the Billing page.

**Postconditions:** organization on the new plan; quotas enforced at new limits; local state matches provider.
**DB:** `billing_customers` (org ↔ LS customer ID); `subscriptions` (subscription/order/product/variant IDs, status, renewal/end dates, test mode, portal URL); `billing_webhook_events` (event identity/hash, received/processed, retry diagnostics); `plan_entitlements`; `usage_counters`; `audit_events` (billing action).
**Failure paths:** forged/missing/replayed signature → rejected, no state change (W8 tests); duplicate or out-of-order events → must not duplicate or roll back newer transitions; checkout abandoned → no entitlement granted; webhook never delivered → local state stays at the old plan until LS retries succeed (UI shows stale-plan guidance); payment failed → `past_due` with recovery path; concurrent calls at the quota boundary → atomic counters prevent bypass; browser redirect alone must never grant a plan (plan §18 W8 gate). W8 resolves the Trial allowance as 25 AI drafts per UTC month and paid subscription expiry/failure as a fail-closed fallback to Free, while a scheduled cancellation remains paid until `ends_at`.
