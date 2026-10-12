# Questionnaires (Weeks 4–6)

Customer security questionnaires are imported from the `.xlsx`/`.csv` files
buyers send, answered inside QuestCite, reviewed, and exported back. This
document covers the import/mapping/answer surface shipped in Week 4, the
grounded AI drafting workflow shipped in Week 5, and the review workflow,
export pipeline, version history, notifications, and dashboards shipped in
Week 6.

## Surfaces

- `/app/[orgSlug]/questionnaires` — library: import card (owner/admin/
  reviewer), lifecycle badges, question counts, owner/admin delete.
- `/app/[orgSlug]/questionnaires/[id]/mapping` — the mapping preview.
- `/app/[orgSlug]/questionnaires/[id]` — the question data table with review
  panel, export panel, progress dashboard, and per-question workspaces.
- `/app/[orgSlug]/review` — the reviewer queue ("assigned to me" +
  "awaiting review").
- `/app/[orgSlug]/notifications` — the in-app notification feed.

Roles follow the plan §4 permission matrix: owner/admin/reviewer import,
answer, comment, assign, transition answer status, and export; viewer is
read-only everywhere. The database re-checks every action (RLS + SECURITY
DEFINER RPCs), so the UI gating is convenience, never the boundary.

## AI drafting (plan §10/§11/§18-W5)

The questionnaire workspace exposes **Generate drafts** for all eligible
questions, selected checkboxes, and a single expanded question. Drafting is
available only after import and only to owner/admin/reviewer roles. The
browser drives short resumable batches through authenticated endpoints:

- `POST /api/questionnaires/{id}/runs` starts an idempotent run. The server
  supplies the configured model and prompt version; the client supplies a
  replay key and optional question ids.
- `POST /api/answer-runs/{id}/next` claims at most ten items transactionally,
  retrieves only same-workspace current evidence, calls the provider, validates
  the structured result, and completes each item with usage/cost totals.
- `POST /api/answer-runs/{id}/cancel` skips pending work while allowing an
  already-claimed item to finish; `POST /api/answer-runs/{id}/retry` reopens a
  failed item within the database retry cap.

Refresh/resume is intentional: an active run shows processed, remaining,
failed, and skipped counts and can be resumed after a tab closes. A stale
`processing` claim older than the provider timeout becomes the safe
`RUN_INTERRUPTED` failure before another batch is claimed, so abandoned work
cannot strand a run or be overwritten by a late worker.

The model receives only delimited, explicitly untrusted evidence blocks and
has no tools. Structured output is revalidated server-side; `approved` is not
a model disposition, citations are restricted to the retrieved set and
validated again in the database, and empty evidence/answers abstain as
`insufficient_evidence`. AI writes can create `drafted` content only. A human
must review or approve it, and manual rewrites clear AI provenance and
citations.

Each AI-authored answer shows its disposition, transparent evidence-strength
label, review note, and an expandable evidence drawer. The drawer rehydrates
citations through organization-scoped reads, shows retrieval scores and
review-date/source-change warnings, and marks unavailable sources without
exposing storage paths or provider payloads. If AI is disabled or no provider
key is configured, the UI explains that state and does not start a run.

## Import flow (plan §9)

1. **Upload** — `POST /api/questionnaires/upload` (a route handler because
   files run to the 10 MB ceiling while Server Action bodies cap far below).
   The gate: Zod metadata validation → magic-byte/extension/MIME agreement
   (`src/lib/files/questionnaire/validate.ts` — a renamed workbook or a fake
   `.xlsx` both fail with stable codes) → in-memory inspection (zip safety
   scan: macros/encryption rejected; then parse) → `create_questionnaire_upload`
   RPC creates the questionnaire (`importing`), the file row, and the
   server-built storage path **with the CSV transport metadata in the same
   insert** (`questionnaire_files.metadata` is insert-immutable — migration
   0013 carries `{delimiter, bom}` for csv, `{}` for xlsx) → the original
   bytes are stored unmodified. On storage failure the questionnaire remains
   visible in `importing` state; owners/admins can delete it from the list
   and re-import.
2. **Mapping preview (mandatory confirmation)** — the mapping page re-reads
   the STORED original from storage and re-inspects it; detection
   (`detect.ts`) only PREFILLS the selects. Nothing is imported until the
   user presses **Confirm mapping & import**, and the confirmation re-extracts
   the questions server-side from the stored bytes — client-supplied question
   text is never trusted. The confirm action runs
   `mark_questionnaire_mapping` (one-way `importing → mapping`) then
   `confirm_questionnaire_mapping` (replace-then-insert, `→ active`, audited).
   Sheets are capped at 2000 rows / 64 columns by inspection; imports are
   capped at 1000 questions (whole-import rejection, no partials).
3. **Data table** — search (normalized text ILIKE), status/category/assignee
   filters, 25-per-page pagination, bulk assign + bulk blank-by-choice
   (`set_question_assignee` / `set_question_blank_by_choice` — both atomic,
   one foreign id rejects the batch), per-question category editing
   (`update_question_category`, 1–80 chars), and a header progress meter
   ("X of Y resolved": answered or any review state, the W5
   `insufficient_evidence` disposition, or `blank_by_choice` count as
   resolved — AI-drafting states do not). Row checkboxes join the bulk
   toolbar form remotely via the `form` attribute: the table must NOT live
   inside a form because expanded rows contain their own comment forms
   (nested forms are invalid HTML and break React's form submission).

## Answers, conflicts, review states

- The answer editor autosaves 800 ms after the last keystroke via
  `save_answer`, sending the revision the client last saw. A mismatch raises
  `ANSWER_CONFLICT`: autosave stops, the field locks, and an explicit
  **Reload** is required — a concurrent edit is never silently overwritten.
  Empty drafts are not saved (the database rejects blank answers).
- Editing an APPROVED answer demotes it to `answered` and clears the approval
  (audited) — approval always refers to the text it approved.
- Review transitions mirror the DB state machine exactly
  (`answered → in_review → approved | changes_requested | rejected`, with
  resubmit paths); only legal targets are ever rendered. Self-approval is
  allowed for humans (owner decision 2026-09-02; the W5 "AI never approves"
  gate is enforced in the AI path).
- `blank_by_choice` (D012 conscious blanks) marks a question deliberately
  unanswered in bulk; the export rule (W6) treats it as export-eligible.
- Comments are threaded per question (parent must stay in the same question),
  insert as yourself (O/A/R), delete by author or owner/admin.

AI-generated drafts are visibly separate from human answers: `drafted` and
`insufficient_evidence` are resolved statuses for the progress meter, but
only a human transition can reach `approved`.

## Review workflow (plan §W6)

- **Answer versions** — every saved text change snapshots an immutable
  `answer_versions` row (trigger-written, newest 50 kept per answer); status
  transitions and approvals are NOT content versions. The question workspace
  exposes the history with a two-version line-diff compare view
  (`/api/questions/{id}/versions`, member-readable).
- **Bulk review** — the bulk toolbar offers submit / approve / request
  changes / reject over the selected questions. "Where safe" is enforced in
  `bulk_set_answer_status`: every selected answer must currently sit in the
  required source state (submit: answered or drafted; the others: in_review),
  the batch is all-or-nothing, and the rows are locked before the eligibility
  count so a concurrent move rejects the WHOLE batch
  (`ANSWER_BULK_STATE_CHANGED`) instead of approving something unseen.
- **Questionnaire lifecycle** — `set_questionnaire_status` walks
  `active ↔ in_review → completed` (plus `completed → in_review` reopen).
  Completing requires every question to be D012/D021/D023-export-eligible —
  answered, reviewed, AI-dispositioned, or consciously blank; unreviewed AI
  drafts block it (`QUESTIONNAIRE_NOT_RESOLVED`). `exported` is set only by
  the export path and freezes answers.
- **Reviewer assignment** — `set_questionnaire_reviewer` assigns an O/A/R
  member (or clears) with an audit event and a notification. Question-level
  assignment stays on the bulk toolbar.
- **Review queue** — `/review` lists questions assigned to you in actionable
  states plus everything sitting in review (review roles).
- **D010 final resolution** — the `answer_status` enum is THE single answer
  lifecycle; `ai_disposition` remains raw provider provenance only. Humans
  may self-approve (D022); the AI never can.

## Export (plan §9/§W6)

Export requires the questionnaire to be `completed` (or `exported`, for
re-export) and every question resolved — the same rule the completed gate
enforces, surfaced live in the export panel's readiness line. The pipeline:

1. Load the UNTOUCHED original from storage and verify every mapped question
   cell still matches the import (plan §9: refuse on drift —
   `EXPORT_MAPPING_INVALID`).
2. Write ONLY mapped answer cells through the W4 round-trip-safe writer:
   answered/reviewed text as-is; conscious blanks and AI abstentions as
   deliberately empty cells. An opt-in "QuestCite Summary" sheet (xlsx only)
   can be appended; original sheets keep their order and content.
3. Reopen and verify the export; refuse to ship an unreadable workbook
   (`EXPORT_VERIFY_FAILED`).
4. SHA-256 the bytes, upload as a NEW storage object
   (`{org}/{questionnaire}/{export-id}/{safe-dated-filename}` — the same
   object shape and storage policies as originals), and record the export via
   `record_questionnaire_export` (history row + `completed → exported` +
   audit + notifications). A refused record removes the orphaned upload.

History (newest 20) renders on the workspace with shape counters and the
checksum; downloads go through `/api/questionnaires/{id}/exports/{exportId}/
download`, which issues a 60-second signed URL carrying the safe filename —
member-checked, never logged, never stored. Deleting a questionnaire removes
its export objects as well as the original.

## Notifications & email (plan §W6)

The 0018 triggers write in-app notifications on the human review moments —
assignment (question + questionnaire), submit/request-changes/reject/approve,
comments, and exports — always excluding the actor and non-members, capped at
500 per user. The feed is at `/notifications` with per-row and bulk mark-read
(RLS scopes updates to the caller's own rows). The five essential email
templates (assignment, review requested, changes requested, comment, export)
render in `src/lib/email/templates.ts`; delivery runs through the email
abstraction, with LOG MODE as the safe default and optional W8 Resend delivery
when the deployer configures it. Logs carry the template key and recipient user
id only, never content.

## Notable implementation details

- The mapping → import extraction (`extract.ts`) is a pure function emitting
  the RPC wire format **snake_case** (`sheet_name`, `row_number`, …) — the
  shape is the jsonb contract with `confirm_questionnaire_mapping`; unit
  tests pin the exact key set.
- Autosave deliberately skips `revalidatePath` (a full table re-render per
  save would destroy input focus); the editor reports saved revisions to its
  row island (`QuestionWorkspace`), which the server re-mounts by key after
  refreshes so client state can never drift from server truth. The category
  editor is a SEPARATE island keyed by the category itself — the workspace's
  revision-bump remounts would otherwise wipe in-progress category typing.
- All workbook parsing is server-only (`inspect.ts` imports `server-only`);
  the mapping UI receives the client-safe inspection types and safe constant
  warning codes only.

### W5 verification

The 50-question corpus in `tests/fixtures/ai/w5-corpus.ts` checks retrieval
recall, stale-strength handling, prompt-defense gates, and unsupported-question
abstention without a live model call. Hosted RLS tests cover run lifecycle,
cross-tenant citation refusal, retry/cancel/idempotency, and interrupted-claim
recovery.

### W6 verification

Migrations 0018–0020 ship review/export/notification schema and RPCs with
their RLS + grants; the matrix lives in
`tests/integration/rls.review-export.test.ts` (version history + prune,
lifecycle machine, bulk atomicity, approve-vs-edit races, export freeze,
storage-shape inheritance, notification targeting/visibility, audit
completeness). 0019 additionally takes `FOR UPDATE` in `save_answer`/
`set_answer_status` — the race test caught both writers passing the revision
check against the same snapshot. The answer-run gateway maps the drafting
decision onto the RPC's jsonb contract (snake_case citation keys; NULL text
for abstentions) — found by the live workflow verification, unit-pinned in
`tests/unit/services/answer-run-gateway.test.ts`. The export
filename/sheet/round-trip rules are unit-pinned; the flagship E2E walks
upload → export → download.

## Tests

Hosted integration and journey fixtures mutate data and are blocked by default
after production promotion; use a disposable project for these suites once
customer data is accepted.

- Unit: file gate, extraction (coordinates/skip rules/limits/wire keys),
  Zod schemas (incl. the category band), progress counter, export rules +
  readiness + safe filename, version diff, review actions, dashboard
  aggregation, email templates + log transport.
- Integration (`pnpm test:db`): cross-tenant RLS matrix over all five tables
  and every RPC incl. `update_question_category`
  (`rls.questionnaires.test.ts`), the W6 matrix
  (`rls.review-export.test.ts`), storage policies
  (`storage.questionnaires.test.ts`), upload metadata contract
  (`questionnaire.import-metadata.test.ts`).
- E2E (`tests/e2e/questionnaire-journey.spec.ts` and
  `tests/e2e/export-journey.spec.ts`, gated like the auth journey): W4 —
  upload → mapping (axe-checked) → confirm → autosave → submit for review →
  reload → category edit → comment; W6 flagship — answer → bulk review →
  approve → review queue → lifecycle → export blocked → export → download →
  history + notifications (axe-checked), against the hosted project.
