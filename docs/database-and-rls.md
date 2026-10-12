# Database and RLS (Weeks 2–7 schema)

Single hosted Supabase project (D016 — no Docker). Migrations are forward-only
SQL in `supabase/migrations/`, applied with `pnpm db:migrate:remote`; types are
regenerated with `pnpm db:types` (`--linked`) and committed.

## Tables shipped in `0001_identity_tenancy`

| Table | Purpose |
|---|---|
| `profiles` | App profile keyed 1:1 to `auth.users` (trigger-created; email mirror kept in sync). Clients may update only `full_name`/`avatar_url` (column grants). |
| `organizations` | Tenant. Slug: 3–40 chars `[a-z0-9-]`, case-insensitively unique, reserved list enforced. `slug`/`status` are not client-writable. |
| `organization_members` | Role source of truth (`app_role`: owner/admin/reviewer/viewer). PK (org, user). Final owner cannot be demoted or removed (trigger; cascade-aware so owners can still delete their org). |
| `organization_invites` | SHA-256 hex token hash only; role can never be `owner`; one pending invite per email per org; expiry/revocation/acceptance tracked. |
| `audit_events` | Actor/org/action/entity + safe metadata. Read: members. Insert: owner/admin as themselves. |
| `trust_centers` | Minimal W2 shape so onboarding's atomic RPC can create the default row; public policies land in Week 7. |

## Tables shipped in `0003_knowledge_documents` (Week 3)

| Table | Purpose |
|---|---|
| `documents` | Logical evidence document: title, free-text category, tags, owner, review date, `active`/`archived` state. Clients update metadata columns only; inserts happen via `create_document_upload`. |
| `document_versions` | Immutable upload record: server-built storage path, MIME, size, checksum, parser version, processing state (`pending → parsing → embedding → ready / failed`, PRD §7.6 question resolved by this enum), safe error code, retry attempts. Content columns are grant-locked AND trigger-protected (`VERSION_IMMUTABLE`). |
| `document_chunks` | Retrieval unit: section label, content, token estimate, checksum, `vector(1536)` embedding, generated `tsvector`. Unique per (version, sequence); HNSW + GIN indexes. Clients insert/delete only through org-matched policies. |
| `knowledge_entries` | Approved short Q&A: question, answer, category, tags, review state (`draft/approved/needs_review/retired`), generated `tsvector`. Writes only via `save_knowledge_entry`. |
| `knowledge_entry_versions` | Immutable edit history — SELECT-only for clients (append-only by privilege). |

Permission matrix (PRD §5): owner/admin upload/manage evidence; reviewer/viewer
read. Processing states: `pending → parsing → embedding → ready | failed`;
chunking is an in-memory step. Retry cap = 3 attempts (also `CHECK`-bounded),
enforced by the retry RPC which wipes stale chunks first (idempotent
reprocessing).

## Storage: private `documents` bucket

Object keys are built SERVER-SIDE by `create_document_upload` as
`{organization_id}/{document_id}/{version_id}/{sanitized_filename}` — clients
never choose a path. Policies re-derive the org from the first segment and are
declared `TO PUBLIC` with conditions doing all the work (anon/JWT-less callers
evaluate FALSE):

- `storage_document_member_access(path)` / `_manager_access(path)` /
  `_path_valid(path)` — public-schema SECURITY DEFINER wrappers over the
  private helpers, so storage policies never depend on which role the storage
  service uses (lesson from 0004–0006).
- `valid_document_object_path` validates the 4-segment shape with core
  `string_to_array` — NOTE: `storage.foldername()` returns parent folders
  ONLY (no filename segment); relying on it broke every upload until 0008.
- No UPDATE policy: objects are immutable; a changed file means a new version.

## Authorization helpers (private schema, SECURITY DEFINER, `search_path = ''`)

`is_org_member(org, roles?)`, `is_org_member_as(user, org, roles?)`,
`current_org_role(org)`, `shares_organization(user)`, `storage_org_of(path)`,
`valid_document_object_path(path)`, `request_user_id()` (JWT claim resolution
across both Supabase GUCs), plus the audit/immutability triggers. Definer
rights bypass RLS, which prevents policy recursion on `organization_members`.
Non-exposed schema; EXECUTE granted to `authenticated` only.

## RPCs (public schema, definer, stable error codes as messages)

- `create_organization_with_owner(name, slug)` — one transaction: org + owner
  membership + default trust center + audit event; reserved-slug and
  verified-email checks; `SLUG_TAKEN` / `SLUG_RESERVED` / `EMAIL_NOT_VERIFIED`.
- `accept_organization_invite(raw_token)` — verifies hash, email match, expiry,
  revocation, org status; membership + acceptance in one transaction; every
  rejection raises the same `INVITE_INVALID` (nothing leaks).
- `preview_organization_invite(raw_token)` — invitee-only preview (J2 step 3).
- `revoke_organization_invite(org, invite)` — owner/admin, idempotent, audited.
- `create_document_upload(...)` — owner/admin; validates metadata + MIME +
  size + checksum; creates document (or new version) + version row + audit
  atomically; returns the server-built storage path.
  `DOCUMENT_INPUT_INVALID` / `DOCUMENT_TYPE_UNSUPPORTED` / `DOCUMENT_EMPTY` /
  `DOCUMENT_TOO_LARGE` / `DOCUMENT_NOT_FOUND` / `VERSION_LIMIT_REACHED`.
- `reset_document_version_for_retry(org, document, version)` — failed-state +
  cap check, wipes chunks, resets to pending.
  `RETRY_NOT_ALLOWED` / `RETRY_LIMIT_REACHED` / `DOCUMENT_NOT_FOUND`.
- `save_knowledge_entry(...)` — owner/admin; entry + immutable version row in
  one transaction. `ENTRY_INPUT_INVALID` / `ENTRY_NOT_FOUND`.
- `match_org_evidence(org, embedding|null, text, count)` — org-scoped hybrid
  search (vector similarity + full-text rank) over CURRENT ready versions and
  approved entries; FORBIDDEN for non-members before any data is touched.
  pgvector operators are schema-qualified (`OPERATOR(extensions.<=>)`) because
  definer functions run with `search_path = ''`.

## Tables shipped in `0010_questionnaires` + fixes `0011`–`0013` (Week 4)

| Table | Purpose |
|---|---|
| `questionnaires` | Imported questionnaire: title, free-text customer label, status (`importing → mapping → active → in_review → completed → exported`, plus `archived` — PRD §7.1; later states activate in W5/W6), due date, assigned reviewer. Metadata columns are O/A/R-writable; delete is O/A; status changes happen only inside RPCs. |
| `questionnaire_files` | The UNTOUCHED original: server-built storage path, format (`xlsx`/`csv`), MIME, size, checksum, parser version, CSV transport metadata (delimiter/BOM), and latest-export columns. Content columns are grant-locked AND trigger-protected (`FILE_IMMUTABLE`); one file per questionnaire. |
| `questions` | One normalized question per source cell: sheet/row/question-cell/answer-cell/notes-cell coordinates, original + normalized text, category, assignee, `blank_by_choice` (D012 conscious-blanks marker). `status` is denormalized from `answers.status` by trigger (a question with no answer row reads `empty`). Generated `tsvector` over the normalized text. Insert-only via `confirm_questionnaire_mapping`. |
| `answers` | One current answer per question (UNIQUE): text, workflow status (PRD §7.2 merged lifecycle; W4 uses the manual subset), creator type, approver + approved-at, optimistic-concurrency `revision`. No client INSERT/UPDATE at all — written only via RPCs so revisions, approvals, and the state machine cannot be bypassed. |
| `comments` | Threaded discussion per question (parent must stay inside the same question — policy-checked with qualified correlation names, fix 0011). O/A/R insert as themselves; delete is author-or-O/A; no updates (immutable). |

Answer state machine (BEFORE UPDATE trigger; same-status text edits always
allowed): `answered → in_review → approved | changes_requested | rejected`;
`changes_requested → in_review` (resubmit); `rejected → answered` (rewrite);
`approved → answered` (RPC-driven demotion when the text of an approved answer
is edited — approval always refers to the text it approved; the demotion is
audited). AI-only statuses (`generating`/`drafted`/`insufficient_evidence`)
exist in the enum but their transitions arrive with W5. Human self-approval is
ALLOWED (owner decision 2026-09-02, feeds D010 final resolution due W6).

Export rule (D012, owner decision 2026-09-02): CONSCIOUS BLANKS — a question
is export-eligible when approved or explicitly `blank_by_choice`; unapproved
text is never written to an export.

## Storage: private `questionnaires` bucket

Keys `{organization_id}/{questionnaire_id}/{file_id}/{sanitized_filename}`,
built server-side by `create_questionnaire_upload`. Policies follow the full
W3 invariant set (0005/0006/0007): TO PUBLIC, membership via
`private.request_user_id()`, through PUBLIC definer wrappers
`storage_questionnaire_member_access` (select: any member),
`_importer_access` (insert: owner/admin/REVIEWER — the permission matrix
grants import to reviewers, unlike the documents bucket),
`_manager_access` (delete: owner/admin), and `_path_valid` (4-segment shape
over `string_to_array`; 0008 lesson). No UPDATE policy — objects are
immutable; exports are new objects.

## Week 4 RPCs

- `create_questionnaire_upload(org, title, customer, due_date|null, filename,
  mime, bytes, checksum, metadata jsonb default '{}')` — O/A/R; validates +
  creates questionnaire (status `importing`) + file row + server-built path
  atomically. `metadata` (0013) records CSV transport metadata at INSERT time
  — `questionnaire_files.metadata` is insert-immutable, so CSV uploads MUST
  pass `{delimiter, bom}` (delimiter ∈ `,` `;` tab `|`, bom boolean) and xlsx
  uploads MUST pass `{}`.
  `QUESTIONNAIRE_INPUT_INVALID` / `QUESTIONNAIRE_TYPE_UNSUPPORTED` /
  `QUESTIONNAIRE_EMPTY` / `QUESTIONNAIRE_TOO_LARGE` / `FORBIDDEN`.
- `mark_questionnaire_mapping(org, id)` — one-way `importing → mapping` latch.
- `confirm_questionnaire_mapping(org, id, questions jsonb, parser_version)` —
  O/A/R; validates EVERY element (sheet/cells/text lengths), replace-then-insert
  (idempotent recovery before activation), sets parser version, `→ active`,
  audits with the question count. Whole import is transactional: any bad
  element rejects all of it. `MAPPING_INPUT_INVALID` / `MAPPING_DUPLICATE_CELL`
  / `QUESTIONNAIRE_STATE_INVALID` / `QUESTIONNAIRE_NOT_FOUND`.
- `save_answer(org, question, text, expected_revision)` — O/A/R; creates the
  answer (revision 1) or updates it. `expected_revision` mismatch →
  `ANSWER_CONFLICT` (autosave conflict detection). Editing an approved answer
  demotes it to `answered` + clears + audits the approval. Blank/oversize →
  `ANSWER_INPUT_INVALID`. Blocked outside `active`/`in_review`/`completed`.
- `set_answer_status(org, question, status, expected_revision)` — O/A/R;
  transition set limited to `in_review`/`approved`/`changes_requested`/
  `rejected`; the DB trigger owns the state machine
  (`ANSWER_TRANSITION_INVALID`); approval records approver + timestamp; audit
  per transition (from/to only). Autosave text edits are deliberately NOT
  audit events — W6 answer version history is the content trail.
- `set_question_assignee(org, question_ids[], assignee|null)` — O/A/R bulk;
  assignee must be an O/A/R member; ATOMIC (count mismatch →
  `QUESTION_NOT_FOUND`, nothing applied); audited with the count only.
- `set_question_blank_by_choice(org, question_ids[], value)` — O/A/R bulk
  toggle (D012 marker); atomic; audited.
- `update_question_category(org, question, category)` — O/A/R; validated.

## Week 5 AI drafting schema and RPCs (migrations 0014–0017)

| Table / object | Purpose |
|---|---|
| `private.ai_limits` | Singleton caps for questions/run, citations/answer, item attempts, and claim batch size. It is not client-readable. |
| `answer_runs` | Org/questionnaire-scoped resumable run, idempotency key, model/prompt stamp, status, usage, estimated cost, and safe error code. |
| `answer_run_items` | One claimed question per run with pending/processing/completed/failed/skipped status, attempts, disposition, and safe error code. |
| `answer_citations` | Org-scoped source references with excerpt hash, retrieval score, and position; source ids are validated transactionally because the target is polymorphic. |
| `answers` AI columns | `ai_run_id`, disposition, evidence strength, and review note preserve model provenance without giving the model an approval path. |

Every Week 5 tenant table has explicit grants, member-read RLS policies, and
RPC-only writes. `start_answer_run` takes a questionnaire row lock and accepts
a replay key; duplicate requests return the original run. It excludes
approved/in-review/generating/blank-by-choice questions. The claim RPC uses
`FOR UPDATE SKIP LOCKED`, and `complete_answer_run_item` validates every
source against the same organization’s current ready document version or
approved knowledge entry before writing a draft/citation. The database trigger
and RPC ceiling make AI approval impossible; human review actions remain the
only route to approval.

The browser-driven run loop is:

`start → claim small batch → retrieve → structured draft → validate → complete → resume`

`cancel_answer_run` skips pending items while preserving already-spent
in-flight work. `retry_answer_run_item` reopens failed items within the capped
attempt budget. Migration `0017` recovers processing claims older than two
minutes as `RUN_INTERRUPTED`, then claims the next pending batch or finalizes
the run, preventing a crashed worker from leaving permanent `processing` rows.

The global kill switch is `AI_ENABLED` (checked before the HTTP start/next
routes); the per-workspace switch is `organizations.ai_drafts_disabled` and
is checked again inside `start_answer_run`. Provider failures and database
errors cross the HTTP boundary only as allow-listed stable codes. Token usage
and estimated micro-USD cost accumulate on the run; no prompt, answer,
provider response, or signed URL is logged or duplicated into citations.

Limits live in `private.questionnaire_limits` (singleton): 10 MB per file,
1000 questions per import, 4000-char questions, 10000-char answers, 2000-char
comments — mirrored in `src/config/questionnaires.ts` for instant UI feedback.

## RLS rules (plan §7)

RLS enabled on every table; all privileges revoked from `anon`/`authenticated`
first, then granted per operation; separate policies per action; `(select
auth.uid())` initiator pattern; `anon` has zero grants on tenant tables;
service role bypasses RLS and is server-only.

## Testing

`pnpm test:db` runs the Vitest client-level suites in `tests/integration/`
against the hosted project: two-org × four-role matrix, cross-tenant IDOR,
invitation lifecycle (expired/reused/wrong-email/revoked/rollback),
constraints, triggers, the full knowledge-document matrix (all five tables,
version immutability, retry cap, entry history), storage isolation (cross-org
upload/sign denials, signed-URL expiry, raw-URL privacy), cross-tenant
vector search, and the Week 4 questionnaire matrix (cross-tenant reads across
all five tables, RPC-only write shapes, comment threading, the import
lifecycle with transactional validation, answer autosave/revision conflicts/
approval demotion, the DB-enforced state machine, bulk operations with
atomicity, and questionnaire-bucket storage policies incl. the
reviewer-import role). Fixtures self-clean (including storage objects); the
service-role key is used only to provision fixtures, never by assertions. The
suite mutates hosted data and is blocked by default under `APP_ENV=production`;
run it before promotion or against a disposable project.
The live embedding smoke test is gated behind `TEST_LIVE_EMBEDDINGS=1` +
`OPENAI_API_KEY` and never runs on CI.

## Week 7 Trust Center schema and RPCs (migrations 0021–0029)

Trust Center content is tenant-owned and uses explicit grants, RLS, and
owner/admin application actions. The public surface does not select these
tables directly. `get_trust_center_overview(slug)` returns the allowlisted
published shape; `submit_trust_access_request_result(...)` returns only the
request ID and whether email confirmation is required. `confirm_trust_access_request(request_id)` is idempotent.

| Table | Purpose and boundary |
|---|---|
| `trust_centers` | Branding, terms, public slug, status, and organization settings. Lifecycle fields are protected by column-level grants and the audited `set_trust_center_slug(...)` / `set_trust_center_status(...)` RPCs. |
| `trust_center_faqs`, `trust_center_certifications`, `trust_center_subprocessors` | Ordered tenant content with an explicit `is_visible`/public-visibility control. |
| `trust_center_documents` | Tenant-owned document cards. A policy and trigger require the referenced `documents` row to belong to the same organization. |
| `access_requests`, `nda_acceptances` | Prospect identity, selected public document IDs, request state, current terms version/hash, salted IP hash, and coarse user-agent bucket. Direct client writes are denied; submission is an atomic RPC. |
| `document_access_grants` | One request/document grant with organization binding, expiry, revocation, and hashed prospect token boundary. Approval validates the requested subset and ready document versions. |
| `download_events` | Safe audit trail for authorized downloads: organization, grant, document/version, timestamp, salted IP hash, and coarse user-agent bucket. |

The request state machine is `submitted` → `pending_review` → `approved` or
`denied`, with lazy expiry. Grants are `active`, `expired`, or `revoked`.
The download authorization RPC checks the token, organization, grant,
document, ready version, and current terms before inserting an event. The
application signs a private Storage URL for 60 seconds only after that RPC
succeeds. Unknown slugs, invalid tokens, wrong documents, cross-tenant IDs,
unready/replaced documents, expired grants, and stale terms use safe generic
errors.

W7 database coverage is in `tests/integration/rls.trust-center.test.ts`:
anonymous direct-table denial, published allowlisting, publish readiness,
slug ownership and uniqueness, cross-tenant card/document guards, atomic
rate limits, clickwrap pinning, optional confirmation, review permissions,
per-document grants, token binding, terms re-acceptance, expiry/revocation,
download-event recording, queue read isolation, and cross-tenant isolation.
Applied migrations and
generated client types must be inspected together after every schema change.
