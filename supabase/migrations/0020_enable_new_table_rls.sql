-- 0020_enable_new_table_rls.sql — Week 6 fix: enable RLS on the 0018 tables.
--
-- 0018 created answer_versions, notifications, and questionnaire_exports with
-- their policies and grants but omitted the ALTER ... ENABLE ROW LEVEL
-- SECURITY statements — caught immediately by the W6 RLS matrix (an org
-- member could read another member's notifications; cross-tenant reads were
-- one negative test away). Policies without RLS enabled are inert; this
-- migration arms them. No policy or grant changes. Forward-only; never edit
-- after applying.

alter table public.answer_versions enable row level security;
alter table public.notifications enable row level security;
alter table public.questionnaire_exports enable row level security;
