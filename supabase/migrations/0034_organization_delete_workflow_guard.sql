-- Week 8: organization deletion must use the confirmed server action/RPC.
-- The legacy table grant allowed a direct owner DELETE, which could bypass the
-- two-step confirmation and the server-side storage cleanup pass.
revoke delete on public.organizations from authenticated;
drop policy if exists "organizations_delete_owner" on public.organizations;
