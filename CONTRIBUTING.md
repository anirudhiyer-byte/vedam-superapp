# How we ship changes to Vedam One

The rule: **never push straight to `main`.** `main` is the live site (prod) and
is branch-protected. Every change goes: branch → preview (staging DB) → PR
(CI must pass) → merge (deploys prod).

## Everyday change (code only)

```bash
git checkout main && git pull            # start from current prod
git checkout -b feature/<name>           # your private draft branch
# ...edit...
git add -A && git commit -m "<what>"     # snapshot the change
git push -u origin feature/<name>        # upload -> Vercel builds a PREVIEW on the staging DB
gh pr create --base main --head feature/<name> --title "<t>" --body "<b>"
# when the Build check is green: merge the PR (GitHub UI, or the REST call below)
gh api repos/anirudhiyer-byte/vedam-superapp/pulls/<N>/merge -X PUT -f merge_method=squash
```

Merging into `main` is what deploys to **production**.

## Where you see things

- **Per-branch preview** — each pushed branch / PR gets its own Vercel URL
  (shown on the PR and in Vercel → Deployments). Runs on the **staging** DB.
- **Combining ground** — the long-lived `staging` branch has a stable Vercel
  URL. Merge several feature branches into it to test them **together** before
  prod:
  ```bash
  git checkout staging && git pull
  git merge feature/a
  git merge feature/b        # staging now has a + b combined
  git push                   # staging preview rebuilds with both
  ```
  `staging` is only a test-bed — you still merge each feature PR into `main`
  individually to ship it.

## Database changes

Code promotes by merging; **schema promotes by running the migration file** —
staging first, prod second.

```bash
# write supabase/migrations/NNNN_<name>.sql as part of your branch, then:
psql "STAGING_URI" -f supabase/migrations/NNNN_<name>.sql   # apply to staging, test
psql "PROD_URI"    -f supabase/migrations/NNNN_<name>.sql   # then prod
```

After any change touching `profiles` / signup, run
`select * from public.preflight_signup_test();` — it must return `ok = true`.

See `supabase/MIGRATIONS.md` for the full DB workflow and the fresh-staging setup.
