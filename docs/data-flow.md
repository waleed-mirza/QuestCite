# Data flow

## Evidence to answer

1. An owner/admin uploads a document through a server-built storage path.
2. The database records an immutable version, checksum, and processing state.
3. Parsing creates bounded chunks; approved knowledge entries are a second
   evidence source.
4. A questionnaire preserves the untouched original workbook and maps each
   question to source coordinates.
5. An idempotent answer run claims small batches, retrieves only current
   same-tenant ready evidence, and validates structured model output.
6. The completion boundary writes an AI draft, disposition, evidence strength,
   review note, and citation hashes. It never approves.
7. A human reviews, edits, approves/rejects, and exports only resolved answers.

## Export

The export service downloads the untouched original, verifies every question
cell still matches the import, writes only mapped answer cells, reopens the
result, and stores a new export object plus an immutable receipt. A summary
sheet is opt-in. Unapproved text is not silently exported.

## Trust Center

The public page calls `get_trust_center_overview(slug)`. The SQL function emits
published, visible fields only; the server service validates the response with a
Zod allowlist. Requests are rate-limited and clickwrap terms are captured by
version/hash. Approval creates expiring per-document grants. The download RPC
checks center, request, grant, document, readiness, and current terms before a
60-second signed URL is issued.

## Billing and lifecycle

Billing webhooks are verified over the raw body and stored in an inbox by
provider event ID and hash. Postgres resolves plan/usage state atomically.
Workspace deletion is a confirmed, owner-only workflow; retention prunes
operational history, not customer document or answer content.
