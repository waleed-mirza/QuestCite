# Changelog

## Unreleased

- Released the repository under the MIT License and added a plain `LICENSE` file for GitHub detection.
- Reworked `/pricing` and marketing open-source copy into a self-host page; removed license-catalog and purchase-proof UI.
- Documented Lemon Squeezy workspace billing as optional; the app builds and runs without `LEMON_SQUEEZY_*` env vars.
- Renamed public `seller` config to `project` and removed remaining commercial-license / buyer-support wording.
- Removed private working notes, the production plan, and sales-listing copy from the public tree.

## 1.0.0 - 2026-09-06

- Rebranded the release to QuestCite, including runtime copy, email templates,
  exports, fixtures, docs, and sales assets.
- Added public FAQ, documentation, privacy, and terms surfaces plus
  robots/sitemap endpoints, with smoke and axe coverage. The project legal and
  support baseline identifies WHH Treasures and whhtreasures@gmail.com.
- Designated the existing linked Supabase project as the production promotion
  target and added fail-closed guards for hosted fixtures and demo seeding.
- Froze the Week 10 feature set and completed the release hardening pass.
- Added offline AI safety evaluation, signed-out Chrome/Edge/Firefox/mobile
  browser coverage, and desktop/mobile visual regression baselines.
- Added the final live workflow smoke with a recorded token-cost estimate;
  ordinary tests remain provider-free.
- Replaced the vulnerable transitive `uuid` resolution with the maintained
  `uuid@11.1.1` release through the locked pnpm override.
- Added the fictional Northstar Cloud read-only public demo at `/demo`.
- Added deterministic demo workbook generation, idempotent Supabase seeding,
  safe verification, and provider-free answer replay.
- Added quickstart, deployment, demo-mode, customization, architecture,
  data-flow, supported-file, troubleshooting, licensing, security, support,
  and legal-disclaimer documentation.
- Added release-package and documentation verification entry points.
## Week 8

- Added billing quotas, signed webhook handling, workspace settings, retention
  controls, and metadata-only owner export.
