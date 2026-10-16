# pyq-data

Data-only branch for the Vedam One PYQ module. Not deployed, not merged into the app.

- `bundles/<paper>.json` — one paper: metadata + questions, transcribed from the source papers and checked against their answer keys.
- `figures/*.png` — question, option and solution figures referenced by name from the bundles.

Loading (staging first, then production):
1. Figures: `net.http_post` to the `pyq-figure-sync` Edge Function with the commit SHA and figure names (copies them into the `pyq-figures` bucket).
2. Questions: `net.http_get` the raw bundle URL at that commit, then `select public.pyq_import_bundle(content::jsonb, '<bucket base url>')` (migration 0019).
