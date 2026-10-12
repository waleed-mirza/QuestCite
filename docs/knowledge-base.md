# Knowledge base (Week 3)

The searchable evidence library the AI answers from in Week 5. Two evidence
classes: **documents** (uploaded PDF/DOCX/TXT/MD files, parsed and chunked)
and **knowledge entries** (short manually approved Q&A pairs). Everything is
org-private; RLS + storage policies are the boundary (see
[database-and-rls.md](database-and-rls.md) for the schema, policies, and RPCs).

## Surfaces (`/app/[orgSlug]`)

| Route | Purpose |
|---|---|
| `/documents` | Library list: search (title + full-text over extracted content), category filter, state filter (`active`/`archived`/`all`), processing-state badge per row. Owner/admin get the upload card. |
| `/documents/[documentId]` | Metadata editor (title/category/tags/review-by), version history with per-version processing state + safe error copy + retry, archive/restore/delete, per-version signed-URL download, "add version" upload. |
| `/knowledge` | Entry list: search (question + answer full-text with question-ILIKE fallback), category + review-state filters. Owner/admin get the create form + delete buttons. |
| `/knowledge/[entryId]` | Entry editor (every save appends an immutable version) + full version history. |

Permission matrix (PRD §5): **owner/admin** upload, edit metadata, retry,
archive/restore, delete, manage entries; **reviewer/viewer** read-only.
Non-members get `AccessDenied`; missing rows 404 without existence leaks.

## Upload → search pipeline (plan §9)

1. The upload form posts multipart to `POST /api/documents/upload` (a route
   handler — Server Actions cap request bodies below the 10 MB ceiling).
2. `requireOrgRole(owner/admin)` → size check → magic-byte + extension +
   encoding validation (`src/lib/files/validate.ts`, stable error codes) →
   filename sanitation.
3. `create_document_upload` RPC creates the document (or a new version of an
   existing one) + `pending` version row atomically and returns the
   SERVER-BUILT storage path `{org}/{document}/{version}/{filename}` — clients
   never choose paths.
4. The file is stored through the user's own client (storage policies re-verify
   org membership from the path).
5. `processDocumentVersion` (`src/features/documents/ingestion.ts`) downloads,
   verifies the SHA-256 checksum, parses (pdfjs-dist / mammoth / UTF-8 text),
   normalizes, chunks (≈600–900 tokens, overlap, per-chunk checksums —
   deterministic, so retries are idempotent), embeds in batches, and inserts
   `document_chunks`.
6. The version ends `ready` or `failed` with a SAFE error code.

### Processing states and error codes

`pending → ready | failed`. Failed versions show a fixed, user-safe message
keyed by the code; retryable codes (`CHECKSUM_MISMATCH`, `PARSER_FAILED`,
`EMBEDDING_UNAVAILABLE`, `EMBEDDING_FAILED`, `CHUNK_INSERT_FAILED`) get a
Retry button, which calls `reset_document_version_for_retry` (failed-state +
3-attempt cap enforced in the database, stale chunks wiped) and re-runs the
pipeline. Non-retryable: `EMPTY_DOCUMENT`, `ENCRYPTED_DOCUMENT`,
`ENCODING_UNSUPPORTED`, `UNSUPPORTED_TYPE`.

`EMBEDDING_UNAVAILABLE` means no embedding provider is configured for the
deployment (e.g. no `OPENAI_API_KEY`) — the document is stored, but not
searchable until the provider exists and the version is retried.

## Search

- Documents: full-text (`websearch`) over chunk `search_vector`, title
  ILIKE fallback, category filter, state filter.
- Entries: full-text over the generated question+answer `search_vector`,
  question ILIKE fallback, category + review-state filters.
- Retrieval-quality search (vector + full-text hybrid, org-scoped, approved
  entries preferred) is the `match_org_evidence` RPC — consumed from Week 5.

## Environment

Hosted integration fixtures mutate data and are blocked by default after
production promotion; use a disposable project for this suite once customer
data is accepted.

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | Enables the embedding provider. Absent → uploads end `EMBEDDING_UNAVAILABLE` (retryable). |
| `OPENAI_EMBEDDING_MODEL` | Defaults `text-embedding-3-small` (1536 dims — must match the `vector(1536)` column). |

Live-AI tests spend real provider credit. The embedding smoke test runs only
with `TEST_LIVE_EMBEDDINGS=1` + `OPENAI_API_KEY`, never on CI.

## Test evidence

- Unit: chunking boundaries, magic-byte/extension validation, filename
  sanitation, parsers (golden fixtures incl. corrupt/encrypted/scanned/empty),
  embedding adapter, Zod schemas, action + read-model behavior
  (`tests/unit/lib/*`, `tests/unit/features/documents-actions.test.ts`,
  `tests/unit/features/knowledge-*.test.ts`) — 159+ tests.
- Integration (`pnpm test:db`): five-table RLS matrix, version immutability,
  upload/retry/entry RPCs incl. stable refusal codes, storage isolation
  (cross-org upload/sign denials, signed-URL expiry), cross-tenant vector
  search (`tests/integration/rls.knowledge.test.ts`,
  `tests/integration/storage.documents.test.ts`) — 87 tests.
- E2E (journey): upload appears in the library, unsupported type rejected with
  the safe copy, reviewer sees no management controls, entry create → edit →
  v2 in history, axe clean on both surfaces (`tests/e2e/auth-journey.spec.ts`).
