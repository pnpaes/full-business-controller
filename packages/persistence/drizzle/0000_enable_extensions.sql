-- Bootstrap extensions required by the generated DDL and the invariants migration.
-- pgcrypto: gen_random_uuid() defaults on uuid primary keys.
-- btree_gist: exclusion constraints combining `=` on scalar columns with `&&` on ranges.
create extension if not exists pgcrypto;
create extension if not exists btree_gist;
