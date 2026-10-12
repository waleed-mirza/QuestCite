-- 0002_invite_preview_fix.sql — W2 RLS-suite finding.
--
-- preview_organization_invite required the caller to ALREADY be a member of
-- the target organization, which a genuine invitee never is — journey J2
-- step 3 (invitee sees org/inviter/role before accepting) was unreachable.
-- The correct gate is exactly the one the accept RPC uses: the caller is
-- signed in with a confirmed account whose email matches the invite. The
-- raw token remains the other half of the key. Function signature is
-- unchanged; this replaces the body in place.

create or replace function public.preview_organization_invite(p_raw_token text)
returns table (organization_name text, inviter_name text, invited_role public.app_role, expires_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select
    o.name,
    p.full_name,
    i.role,
    i.expires_at
  from public.organization_invites i
  join public.organizations o on o.id = i.organization_id
  left join public.profiles p on p.id = i.invited_by
  where i.token_hash = encode(sha256(convert_to(btrim(p_raw_token), 'utf8')), 'hex')
    and i.accepted_at is null
    and i.revoked_at is null
    and i.expires_at > now()
    and o.status = 'active'
    and exists (
      select 1
      from auth.users u
      where u.id = auth.uid()
        and u.email_confirmed_at is not null
        and lower(u.email) = lower(i.email)
    );
$$;

revoke all on function public.preview_organization_invite(text) from public, anon;
grant execute on function public.preview_organization_invite(text) to authenticated;
