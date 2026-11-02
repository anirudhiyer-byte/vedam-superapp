# VSAT exam ↔ Wheebox wiring

How the applicant's **mock** and **main VSAT** tests launch on Wheebox and how
results come back. Data layer is migration `0040_vsat_exam_center.sql`; the crypto
+ API client is `src/lib/wheebox/`.

## Credentials (server-only env vars)

| Var | Meaning | Where |
|---|---|---|
| `WHEEBOX_BASE_URL` | `https://uat.wheebox.com` (UAT) | Vercel (prod + preview) |
| `WHEEBOX_COMPANY_CODE` | company code in the URL path | Vercel |
| `WHEEBOX_ACCESS_TOKEN` | `accessToken` request header | Vercel |
| `WHEEBOX_PRIVATE_KEY` | AES key (MD5'd) for payload/path encryption — **secret** | Vercel |
| `WHEEBOX_CALLBACK_SECRET` | shared secret guarding the result callback — **secret** | Vercel + Wheebox |
| `WHEEBOX_DOMAIN_NAME` | *(optional)* domain name for the result-pull API | Vercel |
| `WHEEBOX_TEST_NAME` | *(optional)* test name for the result-pull API | Vercel |

Never stored in the DB. `src/lib/wheebox/crypto.ts::wheeboxCreds()` reads the first
four; the routes read the rest. The sandbox can't egress to wheebox.com, so the
Wheebox calls only succeed from a deployed (preview/prod) environment.

## Config (non-secret, in `vsat_exam_settings`)

- `mock_test_id` — the Wheebox test id used for the **mock**. Set it in the Exam
  Center before mock launches work (null ⇒ `MOCK_NOT_CONFIGURED`).
- `osr_format` — result-format combo (`o`/`s`/`r` and combos). Set to **`osr`** so
  results carry overall + sectionwise + report.
- Each **exam date** (`vsat_exam_dates`) carries its own `wheebox_test_id` + window.

## Routes

### `POST /api/vsat/exam/launch`  (logged-in applicant)
Body `{ kind: "mock" | "exam" }`. Identity is `auth.uid()` only.
1. Load application + eligibility (paid, or a confirmed `@vedam.org` admin).
2. Resolve test id + window — mock: `mock_test_id`, open now for 2 days; exam:
   the selected date's test id + window (must be inside the clickable window).
3. Register on Wheebox once (`loginId = application_id`), set `wheebox_registered`.
4. Assign the test for `[start,end]` (IST), set `mock_assigned` / `exam_assigned`.
5. Get the test link; if it needs a login, `authenticate` → `verifyWBToken` url.
6. Return `{ ok, url }`; the dashboard opens it in a new tab.

### `GET|POST /api/vsat/exam/wheebox-callback/<secret>/<mock|exam>`  (Wheebox → us)
Matches the Wheebox result callback (API doc §6). Wheebox appends
`?testresult=<encoded json>` to the URL we register, so the **secret and kind live
in the path** (not the query) to avoid a `?` collision. The result is an encoded
JSON string with an `OVERALL` object + `SECTIONWISE` block; method GET or POST.

- The `<secret>` path segment must equal `WHEEBOX_CALLBACK_SECRET`.
- The candidate is matched by `emailId` in the payload (= our loginId = application
  id, or the registered email).
- **mock vs main** is the `<kind>` path segment (one URL per kind). Anything other
  than `mock` ⇒ **exam** — the safe default, because a mock result is student-visible
  and a main-VSAT one must not be.
- Writes the admin-only `vsat_exam_results` ledger always; then **mock** →
  `mock_given` + `mock_result` (student-visible); **main VSAT** → `exam_given` +
  `exam_overall/_obtained_marks/_max_marks/_percentile/_sections` (**admin-only**).
  OVERALL and SECTIONWISE may arrive as separate hits — each writes only its own fields.

Register these with Wheebox (support/portal) as the result callback URLs:
- mock: `https://<deployment>/api/vsat/exam/wheebox-callback/<secret>/mock`
- exam: `https://<deployment>/api/vsat/exam/wheebox-callback/<secret>/exam`

### `POST /api/vsat/exam/pull-result`  (admin)
Body `{ applicationId, kind?: "mock" | "exam" }`. Fallback to the callback: fetches
the result straight from Wheebox and stores it the same way. The result API keys on
domain + test **name** + date — set `WHEEBOX_DOMAIN_NAME` / `WHEEBOX_TEST_NAME` if
the test id isn't accepted as the test name (confirm against a real result sample).

## Admin / staff demo bypass

So an admin can walk the full exam flow for a demo without paying: `vsat_is_staff()`
(migration 0047) = the `is_admin()` role **or** a confirmed `@vedam.org` login — the
same definition the `/vsat` and `/admin` pages use. Staff bypass the paid check in
`vsat_exam_open_dates` / `vsat_exam_select_date`, the launch route (`@vedam.org`),
and the dashboard (`paid = … || isAdmin`). Staff still need an `application_manager`
row (apply once — applying needs no payment). `vsat_payments` stays write-once.

## Student visibility rule (do not break)

The student **never** sees raw main-VSAT marks — only a **VPS score**, set later at
the *VSAT Cleared / Not-Cleared* stage (not by these routes). The **mock** result
**is** shown to the student. Enforced by which columns each path writes.
