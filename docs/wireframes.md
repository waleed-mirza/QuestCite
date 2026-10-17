# QuestCite — Low-Fidelity Wireframes (Week 1)

LOW-FI: boxes and labels only. No visual design, no copy finalization. Each section lists key elements and required states (empty / loading / error / permission-denied) where the plan demands them (plan §16 rule 11, §24).

Route note: plan §13 targets `/app/[orgSlug]/...` for the authenticated area. Shipped in W2 (decision D015): the flat W1 `/dashboard` scaffold was replaced by the org-scoped shell (`src/app/(app)/app/[orgSlug]/`) with the org switcher; wireframes below match.

---

## 1. Marketing landing — EXISTS (`src/app/(marketing)/page.tsx`)

Built: header (logo + shield icon; nav "Features", "How it works" on desktop only; "Sign in" ghost button + "Get started" primary button), hero (eyebrow line, H1, subhead, two CTAs both currently pointing to `/login` because `/signup` is not scaffolded until W2), 3 feature cards, "How it works" 4-step band on muted background, closing CTA band, footer (copyright + tagline line).

```text
+--------------------------------------------------------------------------+
| [shield] QuestCite                Features  How-it-works   [Sign in][Get started] |
+--------------------------------------------------------------------------+
|                 (eyebrow) SECURITY QUESTIONNAIRES, ON AUTOPILOT           |
|              H1: Answer security questionnaires in hours, not weeks      |
|            subhead: drafts from your own documents, cited + reviewed     |
|                  [ Start free -> ]   [ See how it works ]                |
+--------------------------------------------------------------------------+
|  H2: Everything the workflow needs                                       |
|  +----------------+  +----------------+  +----------------+              |
|  | [icon]         |  | [icon]         |  | [icon]         |              |
|  | Import any     |  | Your knowledge |  | Review         |              |
|  | questionnaire  |  | base           |  | workflow       |              |
|  | desc           |  | desc           |  | desc           |              |
|  +----------------+  +----------------+  +----------------+              |
+--------------------------------------------------------------------------+
|  H2: From questionnaire to sent workbook      (muted background band)    |
|  [01 Import][02 Draft][03 Review][04 Export]  <- 4 steps                 |
+--------------------------------------------------------------------------+
|     H2: Ready to stop re-typing the same answers?   [ Get started ]      |
+--------------------------------------------------------------------------+
| (c) year QuestCite             Security questionnaires · KB · Trust Ctr  |
+--------------------------------------------------------------------------+
```

Mobile (single column; nav links hidden behind the `sm:` breakpoint, CTA buttons stack):

```text
+---------------------------+
| [shield] QuestCite |
|            [Get started]  |
+---------------------------+
|  eyebrow                  |
|  H1 (large, wrapped)      |
|  subhead                  |
|  [ Start free -> ]        |
|  [ See how it works ]     |
+---------------------------+
| feature card              |
| feature card              |
| feature card              |
+---------------------------+
| step 01 ... step 04       |
+---------------------------+
| footer                    |
+---------------------------+
```

Annotations:
- W2: primary CTAs move to `/signup`; add Pricing / FAQ / Docs / Legal links per plan §13 route list and §3 "Included in v1" (the initial legal placeholders were replaced by the WHH Treasures project baseline before release).
- Required states: none interactive yet; SEO metadata + Open Graph/social card are tested in W7 for the Trust Center and listed as a release asset in plan §23.
- Disclaimer that the product is not legal/compliance advice must appear on marketing before launch (plan §23).

---

## 2. Onboarding (post-signup, pre-workspace)

```text
+------------------------------------------------------------------+
|  [shield] QuestCite                            step 1 of 1        |
+------------------------------------------------------------------+
|                                                                  |
|   Create your workspace                                          |
|   Workspace name                                                 |
|   +------------------------------------------------+             |
|   | Northstar Cloud                                |             |
|   +------------------------------------------------+             |
|   Workspace URL                                                  |
|   +----------------------------------------+  +-------+          |
|   | northstar-cloud                        |  | edit  |          |
|   +----------------------------------------+  +-------+           |
|   ( ) I understand AI answers are drafts that require human      |
|       review and this tool is not a compliance certification     |
|                                                                  |
|   [ Create workspace ]                                           |
|                                                                  |
+------------------------------------------------------------------+
```

Annotations:
- Submit calls the atomic `create_organization_with_owner` RPC; on failure the user stays here with an inline error and nothing is created (plan §7).
- Slug: derived from the name, editable; collision/reserved slug → inline validation error. The reserved list is shared with the database and includes route/system slugs (D017).
- Loading state on submit (transaction in flight); error state (slug taken, RPC failure). The honest-promise rule is communicated in the marketing/demo surfaces; onboarding does not add a second checkbox.
- No authenticated user + no workspace → redirect here. A verified user with no workspace returns here through `/onboarding`; an existing member is routed to their oldest workspace, with `?new=1` for an additional workspace (D018).

---

## 3. Authenticated dashboard (`/app/[orgSlug]`)

```text
+--------------------------------------------------------------------------+
| [shield] QuestCite              [org switcher v]        [avatar] [Sign out] |
+---------------+----------------------------------------------------------+
| SIDEBAR       | Dashboard                                                |
|  Dashboard    | Workspace overview + persistent banner if DEMO_MODE      |
|  Knowledge    |                                                          |
|  Questionnaires| +-----------+ +-----------+ +-----------+               |
|  Trust Center | | 12        | | 48        | | 7         |               |
|  Access req.  | | Question- | | Knowledge | | Pending   |               |
|  Members      | | naires    | | documents | | reviews   |               |
|  Billing      | +-----------+ +-----------+ +-----------+               |
|  Settings     |                                                          |
|               | Needs your attention                                     |
|               | - 6 answers need review (Acme Co questionnaire)          |
|               | - 1 access request waiting (since Mon)                   |
|               |                                                          |
|               | [ View questionnaires ]  [ Upload document ]             |
+---------------+----------------------------------------------------------+
```

Mobile: sidebar collapses to a top bar with a horizontal scrollable nav (current scaffold pattern, `src/app/(app)/layout.tsx`):

```text
+---------------------------+
| [shield] QuestCite  [menu] |
| Dashboard|KB|Questionnaires|  <- horizontal scroll nav
+---------------------------+
| Stat: Questionnaires  12  |
| Stat: Knowledge docs  48  |
| Stat: Pending reviews  7  |
| Needs your attention      |
| - 6 answers need review   |
| - 1 access request        |
+---------------------------+
```

Annotations:
- Stats derive from real tables: questionnaires, documents, answers awaiting review. Empty state (new workspace): zeroed stats + "Import your first questionnaire" / "Upload your first document" primary actions instead of "Needs your attention".
- "Needs your attention" aggregates: answers awaiting review, pending access requests, failed document processing, failed AI runs. Loading: skeleton cards. Error: retryable panel, not a blank page.
- Org switcher lists only the user's memberships (plan §3 "organization switching"); current Week 1 shell shows a placeholder header line to be replaced in W2.
- Demo variant (`/demo`): banner pinned (see §7), destructive nav items disabled.

---

## 4. Knowledge base (`/app/[orgSlug]/knowledge` + `/documents`)

```text
+--------------------------------------------------------------------------+
| Knowledge base                              [ Search... ] [ + Upload ]   |
+--------------------------------------------------------------------------+
| Tabs: [ Documents (48) ] [ Q&A entries (10) ]                            |
| Filters: category v | status v | tag v | owner v | review due v          |
+--------------------------------------------------------------------------+
| Title              | Category   | Status | Owner | Review due | Strength  |
|--------------------|------------|--------|-------|------------|-----------|
| Security Overview  | Policy     | ready  | Ada   | 2027-01-15 | -         |
| Encryption         | Policy     | ready  | Ada   | 2026-09-30 | stale!    |
| Subprocessor List  | Vendors    | processing... (step 3/5: embedding)       |
| Incident Response  | Process    | error: unsupported file - view details   |
+--------------------------------------------------------------------------+
```

Document detail / upload states:

```text
+----------------------------------------------+   +---------------------+
| Encryption                    v2 (current)    |   | UPLOAD DIALOG       |
| Category: Policy | Owner: Ada | Review due .. |   | drop file / browse  |
| Tags: [product] [geo:eu]                      |   | accepted: pdf docx  |
| +------------------------------------------+ |   |           txt md    |
| | Version 2  ready    2026-08-31  checksum | |   | max 10 MB           |
| | Version 1  superseded 2026-06-02         | |   | [ Upload ]          |
| +------------------------------------------+ |   +---------------------+
| Extracted sections preview (no raw text dump)|
| [ Archive ]  [ Delete ]  (typed confirm)     |
+----------------------------------------------+
```

Annotations:
- Pipeline states surfaced per version: validating → parsing → chunking → embedding → ready | error (plan §9). Error copy is safe: never server paths or file content (plan §16).
- Empty state (no documents): "Upload your first policy" with supported-type list; loading: list skeletons; permission: Viewer sees read-only rows, no Upload button (plan §4).
- Unsupported inputs rejected with explicit reason (scanned PDF, encrypted, `.doc`/`.xls`, archive, > 10 MB) — plan §9, §3.
- Q&A entries tab: short approved question/answer pairs with category + product/geo tags + review state + version history (plan §8).
- Upload dialog is disabled with an explanation in demo mode (plan §15).

---

## 5. Questionnaire editor (`/app/[orgSlug]/questionnaires/[id]`)

```text
+--------------------------------------------------------------------------+
| <- Questionnaires | Acme Co Security Questionnaire        [ Export v ]   |
| Status: In review | Due 2026-10-15 | Progress 32/40 | Reviewer: Ada      |
| Filters: status v | category v | reviewer v | assignee v  [ Search... ]  |
| Bulk: [ Assign v ] [ Generate drafts ] [ Approve ]   (n selected)        |
+--------------------------------------------------------------------------+
| # | Question                     | Status        | Strength | Assignee     |
|---|------------------------------|---------------|----------|--------------|
| 1 | Do you encrypt data at rest? | Drafted       | High     | -            |
| 2 | SOC 2 Type II certified?     | In review     | Medium   | Ada          |
| 3 | Describe your DR process.    | Needs edit    | Low      | Ada          |
| 4 | List all AI vendors used.    | Insufficient  | -        | -            |
+--------------------------------------------------------------------------+
```

Draft / citation / review panel (right side of the editor, or drawer on narrow screens):

```text
+----------------------------------------------+  +----------------------+
| Q1: Do you encrypt data at rest?             |  | ANSWER               |
|----------------------------------------------|  | Status: Drafted      |
| Question cell: Sheet1!B2   Answer cell: C2   |  | Strength: HIGH       |
| Category: Encryption      Assignee: -        |  | [ AI draft text ... ]|
|                                              |  | ~~~~~~~~~~~~~~~~~~~~ |
| Comments (2)                                 |  | Evidence (4)         |
|  Ada: "verify KMS region"                    |  | [1] Encryption p.3   |
|  Ben: "answered in policy v2"                |  |     "...AES-256..."  |
|  [ Add comment ]                             |  | [2] Security Ovw 3.1 |
|                                              |  | [3] Q&A entry #4     |
| History: v2 edited by Ada / v1 AI draft      |  | [4] Backup p.7       |
| [ Request changes ] [ Reject ] [ Approve ]   |  | view full excerpt    |
+----------------------------------------------+  +----------------------+
```

Annotations:
- The evidence drawer shows exactly what supported the draft (plan §18 W5): source title, section/page reference, excerpt, retrieval score. No fabricated percentages — only the High/Medium/Low/Insufficient label (plan §10).
- Status chips map to the answer lifecycle in `docs/prd.md` §7.2: Drafted, In review, Changes requested, Rejected, Approved, Insufficient (abstained — shown with an explicit "no evidence found, answer required manually" affordance, never a blank).
- Batch controls require confirmation and permission checks (plan §18 W6). Reviewer actions hidden for Viewer (plan §4).
- Required states: empty questionnaire (0 questions → import issue guidance), loading (skeleton rows), per-item AI error with retry, run progress bar with completed/failed/remaining counts and resume after refresh (plan §11), permission-denied, mapping-mismatch export error.
- Export menu: `.xlsx` / `.csv` / optional summary sheet; refuses with the mapping-mismatch reason (plan §9).

---

## 6. Trust Center — public page (`/trust/[slug]`)

```text
+--------------------------------------------------------------------------+
|  [logo] Northstar Cloud                                  [ Contact ]     |
|  Security & Trust Center                                                 |
|  Our security practices, certifications, and subprocessors.              |
+--------------------------------------------------------------------------+
| [Search public content...]                                               |
+--------------------------------------------------------------------------+
| Security overview                                                        |
|   short paragraphs                                                       |
| Certifications                                                           |
|   [SOC 2 (Demo)] [ISO 27001 (Demo)] [GDPR ready (Demo)]                  |
| Subprocessors                                                            |
|   Company | Purpose | Data category | Region                             |
| FAQ                                                                      |
|   Q ... / A ...   Q ... / A ...                                          |
| Documents you can request                                                 |
|   +--------------------------------+  +-------------------------------+  |
|   | Security Overview   [Request]  |  | Penetration Test Summary      |  |
|   |                                |  | [Request access]              |  |
|   +--------------------------------+  +-------------------------------+  |
+--------------------------------------------------------------------------+
| Contact: security@...   | (c) Northstar Cloud                            |
+--------------------------------------------------------------------------+
```

Access request form (modal or `/trust/[slug]/request`):

```text
+------------------------------------+
| Request document access            |
| Name        [___________________]  |
| Company     [___________________]  |
| Work email  [___________________]  |
| Documents   [x] Penetration Test   |
|             [ ] Security Overview  |
| [x] I accept the terms (v3)        |
| [link] Read terms                  |
| [ Submit request ]                 |
| After submit: "We'll review your   |
|  request and email you."           |
+------------------------------------+
```

Annotations:
- Anonymous, server-rendered, allowlisted fields only — published via `get_public_trust_center(slug)`; no draft/archived/internal/expired/replaced content ever renders (plan §7, §18 W7 gate).
- Owner/admin side has draft → preview → published states plus per-item public visibility toggles (plan §18 W7); publish action is Owner/Admin only (plan §4).
- Required states: unknown/unpublished slug → 404 (no existence leak); form validation errors; rate-limit exceeded message; success confirmation (pending review); expired/invalid download link page for the prospect.
- Accessibility + mobile layout + robots + social card are tested for this page (plan §18 W7).
- Demo tenant: certifications explicitly marked "Demo" (plan §15).

---

## 7. Demo experience (`/demo`)

Read-only, seeded, no login (plan §15). Same layout as the authenticated dashboard/knowledge/questionnaire surfaces, wrapped in a persistent banner:

```text
+--------------------------------------------------------------------------+
| SAMPLE WORKSPACE - Fictional demo data. Not legal or compliance advice.  |
| Read-only. Editing resets on refresh.  [ Explore the real template -> ]  |
+--------------------------------------------------------------------------+
| [shield] Northstar Cloud (demo)                    [ Sign-up CTA ]       |
| SIDEBAR: Dashboard | Knowledge | Questionnaires | Trust Center           |
+--------------------------------------------------------------------------+
| Questionnaire: Acme Co (40 questions)                                    |
| 32 drafted | 6 need review | 2 insufficient                                             |
| [ Generate answers ]  <- replays stored results with a progress          |
|                          animation; never calls OpenAI                   |
| (download) Completed sample workbook (.xlsx)                             |
+--------------------------------------------------------------------------+
```

Annotations:
- "Generate answers" replays pre-generated results with a realistic progress animation; real AI is off (`LIVE_DEMO_AI_ENABLED=false`) (plan §15).
- Every disabled operation (email, checkout, member invite, deletion, arbitrary uploads, real AI) shows a note that the source template includes the real implementation (plan §15).
- Editing simulated in browser state and resets on refresh; no shared owner password; uploads disabled; rate limiting atomic in Postgres; IPs stored as salted hashes (plan §15).
- Live-AI switch, when temporarily enabled: fixed 5-question fixture, 1 run per verified account per day, 20 runs global per day, automatic fallback to the stored result on quota exhaustion or provider failure (plan §15).
- Owner-only private test workspace (real upload + AI) is separate from `/demo` and never linked publicly (plan §15).
- Production boot fails if demo mutation bypasses are enabled in production settings (plan §15, §14 `check-env.ts`).

---

## 8. Supporting screens (named, not drawn — W2+)

- `/login`, `/signup`, `/forgot-password`, `/reset-password` (plan §13): card layout matching the existing login shell (`src/app/(auth)/login/page.tsx`); states: invalid credentials, unverified email, rate limited, email sent confirmation.
- Members (`/app/[orgSlug]/members`): member list with role dropdown, invite dialog, pending invitations with expiry, final-owner protection on removal.
- Access requests (`/app/[orgSlug]/access-requests`): queue with requester, company, requested documents, terms acceptance, state; approve (select documents + set expiry) / deny.
- Billing (`/app/[orgSlug]/billing`): current plan, usage vs limits, renewal date, cancellation state, portal + update-payment links, upgrade prompts (plan §12, §18 W8).
- Platform admin (`/admin`): allowlist-gated org/subscription/job health only, never document contents (plan §18 W8).
