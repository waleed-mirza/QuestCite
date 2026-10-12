-- 0008_path_validation_fix.sql — Week 3: fix document object-path validation.
-- Forward-only.
--
-- The integration suite's probe matrix isolated the upload blocker: valid
-- four-segment keys were rejected while five-segment keys were accepted. The
-- cause is `storage.foldername(name)` — it returns the object's PARENT
-- FOLDERS only, i.e. every segment EXCEPT the filename (it exists to list
-- prefixes). A valid key `{org}/{document}/{version}/{filename}` therefore
-- yields THREE elements, so the old `cardinality = 4` check rejected exactly
-- the uploads it should have allowed and admitted keys with an extra segment.
--
-- Fix: validate against core `string_to_array(name, '/')`, which returns ALL
-- segments, and keep every other rule intact (org-prefixed uuids, single
-- sanitized filename segment).

create or replace function private.valid_document_object_path(p_path text)
returns boolean
language sql
stable
as $$
  select
    private.storage_org_of(p_path) is not null
    and cardinality(string_to_array(p_path, '/')) = 4
    and (string_to_array(p_path, '/'))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (string_to_array(p_path, '/'))[3] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (string_to_array(p_path, '/'))[4] ~ '^[^/[:cntrl:]\\]{1,200}$'
    and (string_to_array(p_path, '/'))[4] not in ('.', '..')
$$;
