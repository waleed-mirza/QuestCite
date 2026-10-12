# Supported files and limits

## Documents

The evidence importer accepts the MIME types implemented by the document
validation module, including PDF, DOCX, Markdown, plain text, CSV, and XLSX
where the current parser supports them. Uploaded objects are private,
checksum-verified, and capped at 10 MB by the database backstop.

The current document parser matrix is covered by
`tests/unit/lib/parsers.test.ts`, `tests/unit/lib/files-validate.test.ts`, and
the committed parser fixtures. Unsupported, empty, oversized, encrypted, or
malformed inputs fail with safe codes.

## Questionnaires

Questionnaire imports support XLSX and CSV. The original bytes are stored before
parsing and never overwritten. The hard ceilings are:

| Limit | Default ceiling |
| --- | ---: |
| File size | 10 MB |
| Questions per import | 1,000 |
| Question text | 4,000 characters |
| Answer text | 10,000 characters |
| Comment text | 2,000 characters |

CSV transport metadata preserves delimiter and BOM state. XLSX mapping stores
sheet, row, and cell coordinates for round-trip export. Formulas, merges, styles,
and unrelated cells are protected by the round-trip fixture suite.

## AI evidence

Retrieval uses ready current document chunks and approved knowledge entries in
the same tenant. Citations store source references and excerpt hashes, never a
duplicate of the prompt or provider response. No live-AI call is required for
the public demo; see [`demo-mode.md`](demo-mode.md).
