# Database migrations

Every database change is a numbered `.sql` file in `supabase/migrations/`.
No more ad-hoc SQL in the dashboard — that is what caused the Oct 5 outage.

## Cloning prod schema into a fresh staging project (no Docker)

The Supabase CLI's `db dump` needs Docker; the reliable no-Docker path is
`pg_dump` / `psql` directly, using each project's **Session pooler** URI
(port 5432 — the transaction pooler on 6543 breaks pg_dump).

`pg_dump` must be **>= the server major version** (Supabase is Postgres 17),
so install the v17 client tools, not v16.

```bash
# dump prod's structure (schema only, no data)
pg_dump "PROD_SESSION_POOLER_URI" --schema-only --no-owner --schema=public > baseline.sql

# load into an EMPTY staging project (verify it's empty first!)
psql "STAGING_SESSION_POOLER_URI" < baseline.sql
```

Two things a `--schema=public` dump does NOT carry — apply them to staging by hand:

1. **The auth→public signup trigger** (it lives on `auth.users`, in the `auth`
   schema). Without it, new signups never get a `profiles` row:
   ```sql
   drop trigger if exists trg_on_auth_user_created on auth.users;
   create trigger trg_on_auth_user_created
     after insert on auth.users
     for each row execute function public.handle_new_user();
   ```
2. **Extensions** used by the schema — enable in staging before the load:
   `pg_trgm`, `pgcrypto` (and `pg_net`, `pg_cron` if used).

The `permission denied to change default privileges` errors during load are
Supabase-managed and safe to ignore.

## The workflow for every change

1. Write the change as the next numbered file, e.g. `0002_add_x.sql`.
2. Apply it to **staging** and test:
   ```bash
   supabase db push --project-ref <STAGING_PROJECT_REF>
   ```
3. Only after it looks right, apply the same file to **production**:
   ```bash
   supabase db push --project-ref obtzrqgoiqemnalmehdx
   ```

## Rules

- A migration that changes a table used by a trigger must be reviewed for that
  trigger (the Oct 5 lesson: a column added to `profiles` broke the archive
  trigger). Run `select * from public.preflight_signup_test();` after any change
  touching `profiles` / signup — it must return `ok = true`.
- Never edit a migration that has already run on production. Add a new one.
