# VSAT – Wheebox result push (callback) spec

How Wheebox should push a candidate's **mock** / **main** test result to Vedam.
Share this with the Wheebox integration team.

## 1. Endpoint

```
POST   https://<HOST>/api/vsat/exam/wheebox-callback/<SECRET>/<KIND>
GET    (same URL, with the result in the ?testresult= query — also supported)
```

- **`<HOST>`**
  - Staging (test): `vedam-superapp-git-staging-anirudh-iyer-s-projects.vercel.app`
  - Production: (share the prod host separately)
- **`<SECRET>`** — the shared callback secret we gave you. **This is the authentication.**
  It goes **in the URL path**, NOT in an `Authorization` header. There is no separate
  auth header. (If you added the key as a header earlier, that is why it failed.)
- **`<KIND>`** — `mock` or `exam`. Use `mock` for the mock test, `exam` for the main VSAT.

## 2. Headers

| Header | Value | When |
|---|---|---|
| `Content-Type` | `application/json` | POST with a JSON body |
| `x-vercel-protection-bypass` | (the bypass token we gave you) | **Only on the staging host** (it sits behind Vercel preview protection). Not needed on production. |

No `Authorization` header is used or required.

## 3. Body — send the result in any ONE of these forms

**A. Result JSON as the POST body (recommended for your test):**

```json
{
  "OVERALL": {
    "emailId": "VSAT-2027-000123",
    "testName": "VSAT Mock 1",
    "testId": "12345",
    "result": "Pass",
    "obtainMark": "28",
    "maximumMark": "40"
  },
  "SECTIONWISE": [
    { "sectionName": "Quantitative Aptitude", "markObtainInSection": "10" },
    { "sectionName": "Logical Reasoning",     "markObtainInSection": "9"  },
    { "sectionName": "Computer Science",      "markObtainInSection": "9"  }
  ]
}
```

**B. `testresult` as a query parameter** (Wheebox's native callback form):

```
POST .../wheebox-callback/<SECRET>/mock?testresult=<URL-ENCODED JSON above>
```

**C. `testresult` as a field in a JSON body:**

```json
{ "testresult": "<the OVERALL/SECTIONWISE JSON as a string>" }
```

### The one required field: the candidate identifier

The payload **must** carry the candidate's **Wheebox loginId** — which for us equals the
applicant's **`application_id`** (the loginId you were given at registration) — **or** the
applicant's **registered email**. Put it as **`emailId`** inside `OVERALL` (root level also
accepted). We also accept these key names: `loginId`, `email`, `candidateEmail`, `userName`,
`rollNo`, `registrationNo`, `applicationId`.

If this field is missing you get `400 {"code":"NO_EMAIL_ID"}` — which is exactly the error
you hit. The response now also lists the keys we received (`receivedKeys`, `overallKeys`) so
you can see what was sent.

## 4. Success / error responses

| Response | Meaning |
|---|---|
| `200 {"ok":true,"matched":true,"isMock":true}` | Stored and matched to the applicant ✅ |
| `200 {"ok":true,"matched":false,...}` | Stored in our ledger, but the `emailId` matched **no** applicant — check the loginId/email you sent |
| `400 {"code":"NO_EMAIL_ID", "receivedKeys":[…]}` | No candidate id in the payload (see §3) |
| `400 {"code":"NO_RESULT"}` | No result found in query/body |
| `403 {"code":"FORBIDDEN"}` | Wrong `<SECRET>` in the path |
| `503 {"code":"CALLBACK_NOT_CONFIGURED"}` | Server env not set — tell us |

`OVERALL` and `SECTIONWISE` may be pushed in separate hits; each updates only its own fields.

## 5. Field name reference (we alias these; use the bold ones)

| Meaning | Keys accepted |
|---|---|
| Candidate id | **emailId**, loginId, email, candidateEmail, userName, rollNo, registrationNo, applicationId |
| Test name | **testName** |
| Test id | **testId**, testNo |
| Pass/Fail | **result**, grade, status |
| Marks obtained | **obtainMark**, obtainedMarks, marks, score |
| Max marks | **maximumMark**, maxMarks, totalMarks |
| Section name | **sectionName**, name, section |
| Section marks | **markObtainInSection**, marks, score |
