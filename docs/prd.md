# QuestCite — Product Requirements Document (v1)

Status: v1.0.0. This document records the v1 decisions implemented in the source and migrations.
Section references below ("plan §n") point at the original private plan, which is not part of this repository.
Resolved decisions below are the public requirements.

## 1. Product summary

QuestCite is an open-source Next.js application that a team deploys to answer customer security questionnaires. The company's team uploads its approved security evidence (policies, certifications, FAQs, prior answers) into a private, tenant-isolated knowledge base, imports a customer questionnaire from `.xlsx` or `.csv`, generates AI answer drafts grounded strictly in that evidence with visible citations and an evidence-strength label, routes drafts through human review (edit, comment, approve, reject), and exports a completed copy of the original workbook. It also publishes a branded public Trust Center with gated document access requests, and enforces local plan limits. Architecturally it is a modular monolith on Next.js App Router + Supabase (Auth, Postgres with RLS and pgvector, Storage), OpenAI, and Resend (plan §5, §6).

## 2. Value proposition

Security questionnaires are answered by the same people, using the same approved documents, every week; the work is slow because evidence is scattered and because nobody trusts an answer they cannot trace. QuestCite makes the approved evidence the single source from which every answer is drafted, shows the exact source passage behind each claim, forces a human approval gate before anything leaves the building, and returns a ready-to-send workbook — so the same team answers in hours with a defensible trail instead of weeks from memory (plan §1). It is MIT-licensed open source that operators clone, customize, and self-host, with a working public demo (plan §1, §25).

### Honest product promise (plan §1)

The product is a **workflow and drafting system**, not a compliance certification service. It must never claim a company is SOC 2, ISO 27001, HIPAA, GDPR, or otherwise compliant because it uses this application. AI answers are drafts requiring human approval.

## 3. v1 PROMISES

Each item below is a v1 commitment (plan §3 "Included in v1", §1 outcomes, §10, §12, §15):

1. Marketing site with an open-source license page, FAQ, documentation links, WHH Treasures legal/support baselines, and SEO metadata.
2. Supabase email/password authentication; optional Google OAuth configuration (disabled by default).
3. Email verification, password reset, logout, session refresh, protected routes.
4. Multi-tenant organizations, invitations, roles, and organization switching.
5. Private document storage with versions, processing states, tags, owners, review dates.
6. Knowledge entries for short, manually approved question-and-answer pairs (with immutable edit history).
7. Text extraction from PDF, DOCX, TXT, and Markdown (text-based files only).
8. `.xlsx` and `.csv` questionnaire import with a mandatory user-controlled mapping screen.
9. Questionnaire editor: filters, status, progress, comments, reviewer assignment, bulk actions.
10. Retrieval-augmented AI drafting using approved workspace evidence only (in-tenant, hybrid vector + full-text retrieval, 4–8 evidence chunks per question).
11. Structured AI output with evidence references and a transparent high/medium/low/insufficient evidence-strength label (never a fabricated percentage).
12. Human review and approval — edit, comment, approve, reject, request changes, version history, compare.
13. `.xlsx` and `.csv` export that writes only into mapped answer cells of the untouched original workbook (formatting, formulas, sheet order, merges preserved) or produces a completed `.csv`.
14. Public Trust Center: branding, security overview, certifications, subprocessors, FAQ, document cards.
15. Gated document access requests with clickwrap acceptance records, per-document grants, and short-lived signed downloads.
16. Audit history for sensitive actions.
17. In-app notification records and essential transactional emails (invite, access request, approval/rejection, review reminder, questionnaire assignment).
18. Subscription checkout, signed idempotent webhook sync, customer portal link, plan entitlements, and atomic quotas.
19. Owner/admin platform settings and a minimal platform-admin view (no document contents).
20. Seeded public demo ("Northstar Cloud") plus a private live-AI smoke-test mode (plan §15).
21. Full automated test suite and CI (plan §17).
22. Deliverable package: source, migrations, seed data, safe demo, deployment + customization docs, tests, CI, licensing, screenshots, demo video, listing copy (plan §1, §22, §23).

## 4. v1 EXCLUSIONS

Explicitly postponed; must be disclosed on the sales page (plan §3, §25):

- OCR for scanned/image-only PDFs; scanned-only PDFs as knowledge documents.
- `.xls`, `.xlsm`, VBA macro, and password-protected workbook support (import or export).
- Pixel-perfect round-trip export for DOCX or PDF questionnaires (may be imported as reference text later; layout preservation is not promised).
- Browser extension for third-party questionnaire portals.
- Integrations: Salesforce, HubSpot, Slack, Microsoft Teams, Google Drive, SharePoint.
- SAML / enterprise SSO and SCIM.
- Automatic SOC 2 evidence collection or cloud configuration scanning.
- Legal e-signature (v1 records clickwrap acceptance only).
- Per-tenant custom domains.
- Per-tenant bring-your-own AI key.
- Mobile application.
- Per-tenant BYO vector store / hosted file search (rejected by design, plan §6).

## 5. User roles & permissions

Personas (plan §4). Authorization is enforced twice: application services (for good errors) and PostgreSQL RLS (for actual isolation) (plan §4, §7).

| Capability | Owner | Admin | Reviewer | Viewer | Prospect (anon Trust Center visitor) | Platform admin |
|---|---|---|---|---|---|---|
| Manage billing | Yes | Optional/configurable | No | No | No | No |
| Manage members / invites | Yes | Yes (cannot invite owner or elevate self) | No | No | No | No |
| Upload and manage evidence | Yes | Yes | Read | Read | No | No |
| Import questionnaire | Yes | Yes | Yes | No | No | No |
| Generate AI drafts | Yes | Yes | Yes | No | No | No |
| Approve answers | Yes | Yes | Yes | No | No | No |
| Export completed file | Yes | Yes | Yes | No | No | No |
| Publish Trust Center | Yes | Yes | No | No | No | No |
| Request gated document | No | No | No | No | Yes | No |
| Delete organization | Yes | No | No | No | No | No |
| Transfer ownership | Yes | No | No | No | No | No |
| Handle access requests (approve/deny) | Yes | Yes | No | No | No | No |
| View platform health (org/subscription/job status, no document contents) | No | No | No | No | No | Yes |

Notes and open items:

- **Prospect** is any visitor to a published Trust Center who is using the public surface; signed-in membership in another organization does not grant tenant or editor privileges. Visitors see only published content (plan §4).
- **Platform admin** is the template deployer's internal support role, visible only through a server-checked allowlist (`PLATFORM_ADMIN_EMAILS`), never through tenant roles (plan §4, §14).
- Roles live in `organization_members.role` as the source of truth, never in editable user metadata or JWT claims (plan §7).
- Resolved W7: access requests are handled by Owner and Admin only, as shown above. Reviewer and Viewer roles cannot read or mutate the request queue.
- Resolved W7: a signed-in member visiting a public Trust Center is treated exactly like an anonymous Prospect on that public surface. Session identity is not used to widen public reads or grant access.
- Resolved W8: Platform admin has a read-only health view and cannot impersonate tenants. Support work stays in the tenant's normal Owner/Admin permission model.

## 6. Domain terminology

Definitions as used by the plan; table/column names from plan §8.

| Term | Definition |
|---|---|
| Workspace / organization | The tenant. A company account with a name, slug, logo, status, and settings (`organizations`). Created atomically together with its owner membership and default Trust Center/settings; a failed transaction must never leave an ownerless organization (plan §7). "Workspace" and "organization" are used interchangeably in the plan; UI copy says workspace. |
| Questionnaire | A customer security questionnaire imported from `.xlsx` or `.csv` (`questionnaires`: customer, title, status, due date, progress, assigned reviewer). Has one or more source files preserved untouched (`questionnaire_files`). |
| Question | One normalized question row from an import (`questions`): normalized text, source sheet/row/cell, answer cell, category, status, assignee. The original cell coordinates are preserved for round-trip export (plan §9). |
| Answer draft | An AI-generated answer grounded in tenant evidence (`answers`: draft/current text, workflow status, evidence strength, creator type, approved by/at). A draft is never trusted output: it requires human approval before export (plan §1, §10). |
| Knowledge document | An approved security document uploaded to private storage — policies, FAQs, certifications, previous answers (`documents` + immutable `document_versions` with storage path, MIME, size, checksum, parser version, processing state). |
| Chunk | A ~600–900 token slice of extracted document text with modest overlap (`document_chunks`: sequence, section, content, token count, embedding, search vector, checksum). The unit of retrieval and citation. |
| Knowledge entry | A short, manually approved question-and-answer pair with category, product/geography tags, owner, and review state (`knowledge_entries`), with immutable version history. Preferred evidence over raw document chunks (plan §10). |
| Citation | A reference from an answer to an in-tenant source — a document chunk or knowledge entry — with source type, source record/chunk, excerpt hash, and retrieval score (`answer_citations`). Every citation must point to evidence that was actually retrieved for that question, from the current organization (plan §10). |
| Review | The human workflow over a draft: read the draft and its evidence, edit, comment, approve, reject, or request changes (`review_tasks`: assignee, state, due date, resolution). Produces version history and audit events (plan §18 W6). |
| Export | A completed copy of the questionnaire: the untouched original workbook loaded, answers written only into mapped answer cells, saved as a new version — never overwriting the source. Refused when mappings no longer match expected cells (plan §9). |
| Trust Center | The organization's public branded page (`trust_centers`: slug, branding, published state, contact settings) with configurable sections, certifications, subprocessors, FAQ, and document cards. Anonymous visitors see only explicitly published, allowlisted fields (plan §7, §8). |
| Access request | A prospect's request for gated documents (`access_requests`: prospect identity, company, requested files, state, expiry). Approval creates per-document grants (`document_access_grants`) with expiry and produces short-lived signed downloads plus `download_events`. |
| Evidence strength | A transparent computed label on a draft: High / Medium / Low / Insufficient (plan §10). Never a model-generated percentage. |
| Answer run | A resumable, idempotent batch of AI drafting work (`answer_runs`: model, prompt version, status, usage, error, timestamps), driven by client-triggered batches rather than a paid queue (plan §11). |

## 7. Core state machines

Conventions: transitions list (from → to), trigger, and the role allowed to trigger it.
Only states and transitions implemented by the source and migrations are normative;
the archived questionnaire enum is retained for future retention tooling and is not
user-transitionable in v1.

### 7.1 Questionnaire lifecycle

States: `importing` → `mapping` → `active` → `in_review` → `completed` → `exported`;
`archived` is reserved in the enum but has no user transition in v1.

| From → To | Trigger | Who |
|---|---|---|
| (none) → importing | Questionnaire file uploaded; original stored untouched | Owner, Admin, Reviewer (plan §4 import row) |
| importing → mapping | Sheet inspection/column detection complete; mandatory mapping preview shown | System (plan §9) |
| mapping → active | User confirms question/answer/notes column mapping | Owner, Admin, Reviewer |
| active → in_review | Answers submitted for review / reviewer assigned | Owner, Admin, Reviewer |
| in_review → active | Review returned with changes requested, or review withdrawn | Owner, Admin, Reviewer |
| in_review → completed | Every question is export-eligible: it is answered, in a review/terminal state, AI-dispositioned as insufficient evidence, or explicitly blank by choice | Owner, Admin, Reviewer (D021/D023; enforced by `set_questionnaire_status`) |
| completed → exported | Export run produced a verified new file version | Owner, Admin, Reviewer |
| any → archived | No user transition in v1; enum retained for future retention tooling | Not available in v1 |

### 7.2 Answer draft lifecycle

States: `empty` → `generating` → `drafted` | `answered` | `insufficient_evidence` → `in_review` → `changes_requested` | `rejected` | `approved`. Orthogonal label: evidence strength High/Medium/Low/Insufficient (plan §10).

| From → To | Trigger | Who |
|---|---|---|
| empty → generating | Draft requested (single question or batch); `answer_run` created; quota consumed atomically | Owner, Admin, Reviewer (plan §4) |
| generating → drafted / answered / insufficient_evidence | Structured output returned, citations validated server-side | System (AI + validation, plan §10) |
| generating → generating (error) | Model/timeout/validation failure with capped retries, visible error state | System (plan §11) |
| drafted/answered → in_review | Submitted to review or review task assigned | Owner, Admin, Reviewer |
| drafted → approved | Human approves a draft directly from the question workspace | Owner, Admin, Reviewer |
| drafted → changes_requested / rejected | Human records a review decision directly from the question workspace | Owner, Admin, Reviewer |
| in_review → approved | Human approval | Owner, Admin, Reviewer only — the model can never mark its own output approved (plan §10) |
| in_review → changes_requested | Reviewer requests changes | Reviewer, Admin, Owner |
| in_review → rejected | Reviewer rejects | Reviewer, Admin, Owner |
| changes_requested → in_review | Drafted answer edited and resubmitted (new version) | Owner, Admin, Reviewer |
| any unapproved → generating | Re-draft requested; unchanged **approved** answers are never regenerated (plan §10) | Owner, Admin, Reviewer |

Hard rules: empty or invalid citations force `drafted` (needs review) or
`insufficient_evidence`; unsupported compliance claims are rejected; abstention is
preferred over fabrication (plan §10). The `answer_status` enum is the single
workflow lifecycle; `ai_disposition` is provider provenance only (D025), and a
human drafter may self-approve (D022). AI never writes `approved`.

### 7.3 Review workflow (`review_tasks`)

States: `unassigned` → `assigned` → `in_review` → `resolved`.

| From → To | Trigger | Who |
|---|---|---|
| unassigned → assigned | Answer/question assigned to a reviewer (single or bulk) | Owner, Admin, Reviewer |
| assigned → in_review | Reviewer opens the task | Reviewer, Admin, Owner |
| in_review → resolved | Approve / request changes / reject recorded | Reviewer, Admin, Owner |
| resolved → assigned | Re-review after edits | Owner, Admin, Reviewer |

Rules: bulk review only where safe, with confirmation and permission checks (plan §18 W6); invalid transitions must fail (plan §16 W6 tests); every approval/rejection writes an audit event and notifies the assignee (plan §18 W6).

### 7.4 Access request lifecycle

States: `submitted` → `pending_review` → `approved` | `denied`; terminal `expired`. Grant states: `active` → `expired` | `revoked`.

| From → To | Trigger | Who |
|---|---|---|
| (none) → submitted | Prospect submits form + clickwrap acceptance (terms version + hash recorded) | Prospect (anonymous, plan §8 `nda_acceptances`) |
| submitted → pending_review | Email verification/confirmation step, when enabled | System / Prospect (plan §18 W7 "email verification or confirmation flow") |
| pending_review → approved | Reviewer approves and selects documents + grant expiry | Owner, Admin (D013/W7) |
| pending_review → denied | Reviewer denies | Owner, Admin |
| approved → grant issued | One `document_access_grants` row per requested document, each with its own expiry | System |
| grant active → expired | Expiry passes; signed links fail thereafter | System (plan §7 W7 tests) |
| request any → expired | Request expiry passes | System |

Hard rules: a grant cannot be reused for another document or organization; draft/archived/internal/expired/replaced documents never appear publicly or become grantable; denial must not reveal whether a document exists (plan §18 W7). W7 resolution: the enums above are authoritative; prospect withdrawal is out of scope; grants remain bound to the original document and downloads use its latest ready version, while an archived/removed document fails the same generic denial path.

### 7.5 Subscription states

Local `subscriptions` record synchronized from signed billing webhooks (plan §12). Access is granted only after a valid webhook updates the local subscription.

States: `none` → `trialing` | `active` → `past_due` → `paused` | `cancelled` → `expired`; recovery paths back to `active` (payment recovered, resumed). W8 resolves the local enum as `none`, `trialing`, `active`, `past_due`, `paused`, `cancelled`, and `expired`.

W8 entitlement resolution: Trial provides 25 AI drafts per UTC month; a workspace with no provider subscription remains on the local Trial onboarding plan; an inactive, expired, paused, or past-due paid subscription resolves to Free; a cancellation keeps paid entitlements until `ends_at`. Trust Center access remains available to every plan in v1; the plan examples' Pro gating is not enabled until a separate feature entitlement is defined.

| From → To | Trigger | Who |
|---|---|---|
| none → trialing/active | Valid signed webhook (created / payment success) | System only — never a browser redirect or browser-supplied plan ID (plan §5, §12) |
| active → past_due | Payment failed event | System |
| past_due → active | Payment recovered/success | System |
| active/past_due → paused | Pause event | System |
| paused → active | Resume event | System |
| active/past_due/paused → cancelled | Cancellation event (retains end date) | System |
| cancelled → expired | End date reached | System |

Rules: every event stored idempotently in `billing_webhook_events` (provider event identity/hash) before processing; signature verified on the raw body with constant-time comparison; state update in a short transaction; HTTP 200 returned fast with no slow provider calls; retries and out-of-order events must never duplicate or roll back newer state transitions (plan §12). Last valid subscription state and portal/update-payment URLs are kept locally (plan §12).

### 7.6 Knowledge-document processing (supporting machine)

States: `pending` → `parsing` → `embedding` → `ready` | `failed`.
Failed versions are retryable through the owner/admin RPC up to three attempts;
parser errors never expose server paths or document content in logs.

### 7.7 Invitation lifecycle (supporting machine)

States: `pending` → `accepted` | `expired` | `revoked` (tracked by
`accepted_at`/`expires_at`/`revoked_at`). Only a SHA-256 token hash is stored;
acceptance verifies email match, expiry, unused state, and organization status in
one transaction. Owner/admin revocation is idempotent and audited (D019).

## 8. Non-functional requirements

- **Multi-tenant isolation:** RLS enabled on every table in an exposed schema with separate policies for select/insert/update/delete; explicit grants after revoking unnecessary `anon`/`authenticated` grants; reusable `security definer` helpers in a non-exposed `private` schema with `search_path = ''`; every policy tested as anonymous, Org A owner/admin/reviewer/viewer, Org B user, and service role (plan §7). Verified identity via `getClaims()`, never an unverified `getSession()` object (plan §7). Gate: Org A cannot read or mutate any Org B row or storage path (plan §18 W2).
- **Storage isolation:** private buckets only; key `{organization_id}/{document_id}/{version_id}/{sanitized_filename}`; membership verified from the first path segment; short-lived signed URLs only after an application authorization check; deleting a record schedules removal of its storage objects (plan §7).
- **Audit trail:** `audit_events` (actor, organization, action, entity, safe metadata, timestamp) written for member, role, document access, publication, billing, export, and deletion actions (plan §7), plus generation, edits, approval, and deletion (plan §18 W6). Metadata must be safe — no document contents, prompts, or secrets (plan §8, §16).
- **Citation integrity:** 100% of stored citations must refer to evidence retrieved for that question and belonging to the current organization; the model cannot self-approve; abstention instead of fabrication (plan §10, §18 W5 gate).
- **Quotas and abuse control:** plan entitlements in `src/config/plans.ts` with atomic per-organization/per-period usage counters (`consume_usage`) and atomic rate-limit buckets (`consume_rate_limit`) for demo and sensitive endpoints; concurrency must not bypass limits (plan §8, §12, §18 W8 gate); global and per-organization AI kill switches (plan §10).
- **Secret and log hygiene:** the browser never receives the service-role key, OpenAI/Resend/billing keys, signing secrets, or encryption material; never log secrets, tokens, document content, prompts, answers, signed URLs, SQL, or storage paths; errors never expose SQL, storage paths, prompts, or secrets (plan §5, §16, §18 W10).
- **Demo safety:** public demo runs read-only on seeded fictional data with a persistent "Sample workspace" banner, atomic Postgres rate limiting, salted-hash IPs, disabled email/checkout/invite/deletion/uploads/real AI, and a production boot that fails if public demo mutation bypasses are enabled (plan §15).
- **Performance:** representative Trust Center and questionnaire-list load, large fixture import, and a limited concurrency smoke test are required test classes (plan §17). Deployments record their own baseline and budgets; no universal uptime or latency SLA is made by the source package.
- **Accessibility:** automated axe checks plus keyboard-only manual checks for new interactive UI (plan §16, §17), using WCAG 2.2 AA as the internal target. No accessibility conformance certification is claimed without an operator's manual review.
- **AI safety:** uploaded text is untrusted data, never instructions; the model has no tools and no database/network access; structured outputs rather than free text; adversarial fixtures in the evaluation suite (plan §10). OpenAI receives only the small evidence chunks needed for current questions; AI calls are server-only (plan §5).
- **Reliability of long work:** questionnaire drafting uses resumable, idempotent client-triggered batches with a database job record, capped retries, and visible error states — no dependency on a single long request or a paid queue (plan §11).

## 9. v1 success criteria

Traceable to the Week 10 release gate (plan §18 W10), the self-host readiness bar (plan §25), and the release quality promise (plan §1):

1. All ten Week-10 outcomes are demonstrable on a fresh installation: workspace + invites, knowledge upload, `.xlsx`/`.csv` import, evidence retrieval, grounded AI drafts with visible citations and uncertainty marking, human review, `.xlsx`/`.csv` export, published Trust Center with gated requests, and subscriptions with local limits (plan §1).
2. All CI and release commands pass from a clean checkout; two clean-install rehearsals have succeeded (plan §18 W10).
3. Zero known P0/P1 defects and zero known high-severity security findings; lower-severity defects fixed or disclosed in release notes (plan §1, §18 W10).
4. Critical cross-tenant, billing, citation, and workbook round-trip tests are green; all tenant-isolation tests pass (plan §1, §18 W10).
5. The AI never creates an approved answer, cannot cite another tenant, and abstains instead of fabricating when evidence is absent (plan §18 W5 gate).
6. No browser redirect alone can grant a plan; duplicate webhooks are harmless; limits cannot be bypassed through concurrent calls (plan §18 W8 gate).
7. Automated tests prove private documents and internal metadata cannot leak through public Trust Center pages or downloads (plan §18 W7 gate).
8. The live demo works without paid services except the controlled AI smoke test (plan §18 W10).
9. The customer ZIP contains no secrets, private notes, real customer data, or unsupported claims (plan §18 W10).
10. An operator can clone, install, configure, migrate, seed, test, deploy, rebrand, complete the flagship workflow, publish the sample Trust Center, and switch providers from test to live mode using documentation alone (plan §25).
11. Every exclusion in §4 is disclosed on the sales page (plan §3, §24).
12. Every empty/loading/error/permission state has usable UI; every destructive operation has confirmation, permission checks, and an audit record (plan §24, §16).
