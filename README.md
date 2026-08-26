# Vedam Superapp

One login for the entire Vedam ecosystem — Events, CodeSprint, College Predictor,
Seek Your Seniors, and the internal CRM — on Next.js 15 + Supabase.

## Stack
- Next.js 15 (App Router) / React 19 / TypeScript
- Tailwind 3.4 with Vedam design tokens (light + dark)
- Supabase (Auth + Postgres), scoped to the **`app` schema**
- next-themes, GA4, PostHog

## Getting started (Windows / PowerShell)

1. **Install dependencies**
   ```powershell
   pnpm install
   ```

2. **Add your keys** — copy the template and fill it in:
   ```powershell
   Copy-Item .env.example .env.local
   ```
   Use the same Supabase URL/keys as your existing apps (project `wcwjwchjxfcdupdqipks`).
   Or, once the project is linked to Vercel: `vercel env pull .env.local`.

3. **Run it**
   ```powershell
   pnpm dev
   ```
   Open http://localhost:3000

## Project layout
```
src/
  app/
    layout.tsx              root: fonts, theme, analytics, SEO
    globals.css             light/dark tokens (from the brand book)
    (shell)/                student-facing shell (sidebar + topbar)
      page.tsx              landing / hero
      events/               Events module ports in here
      codesprint/           placeholder
      college-predictor/    placeholder
      seek-seniors/         placeholder
    (admin)/admin/          internal CRM — no student sidebar, admin-only
  components/               logo, sidebar, topbar, theme toggle
  lib/
    supabase/               browser + server + middleware clients (app schema)
    analytics/              GA4 + PostHog
  middleware.ts             refreshes the Supabase session on every request
```

## Notes
- The logo in `src/components/logo.tsx` is a **placeholder**. Drop the official
  Vedam SVGs into `/public` and swap it — the brand book forbids recreating the mark.
- Auth (phone-primary OTP via MSG91, email verify via SMTP2GO), route protection,
  UTM capture, and audit logging are built in the next phases.
- Move the Vercel project to **Pro** before any real students use it (Hobby is
  non-commercial).
