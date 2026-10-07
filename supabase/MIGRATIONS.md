# Database migrations

Every database change is a numbered `.sql` file in `supabase/migrations/`.
No more ad-hoc SQL in the dashboard — that is what caused the Oct 5 outage.

## One-time setup

```bash
# install the Supabase CLI once
npm i -g supabase

# link the CLI to each project (run once per project)
supabase link --project-ref <STAGING_PROJECT_REF>   # staging
supabase link --project-ref obtzrqgoiqemnalmehdx     # production
```

To make **staging match production** the first time, clone the prod schema into
staging once (data stays separate):

```bash
supabase db dump --project-ref obtzrqgoiqemnalmehdx --schema public -f baseline.sql
# review baseline.sql, then apply it to the staging project
```

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
