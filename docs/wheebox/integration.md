# Wheebox integration — production config

Reference for the VSAT exam Wheebox integration (`src/lib/wheebox/*`, `/api/vsat/exam/*`).
No secrets in this file — the token and key live only in Vercel env.

## Base URL (the thing that bites)

- **Production: `https://wgc.wheebox.com`** — this is the live server for our account (company code `1553000`), confirmed against the NPF/Meritto integration that was already live on Wheebox prod.
- UAT / the 1 Aug 2022 API doc default: `https://uat.wheebox.com` — **do not** use in production. The API doc itself notes the server "will be different once your account moves to the production server."
- A company code that exists on prod returns a bare `{"status":"error"}` (no message) when called against the UAT host, which is exactly the "couldn't open the test" symptom. If registration fails with no message, check `WHEEBOX_BASE_URL` first.

## Env vars (Vercel, Production **and** Preview)

| Env var | Meaning | Example / source |
| --- | --- | --- |
| `WHEEBOX_BASE_URL` | API host, no trailing slash | `https://wgc.wheebox.com` |
| `WHEEBOX_COMPANY_CODE` | Company code | `1553000` |
| `WHEEBOX_ACCESS_TOKEN` | `accessToken` request header (the "secCode") | from Wheebox |
| `WHEEBOX_PRIVATE_KEY` | AES key material for payload/path encryption | from Wheebox (often same value as the access token) |

The Exam Center "● Connected" badge only checks that these four are **present** — it is not a live health check, so it can read green while the base URL is wrong.

## Request paths (match the NPF prod config exactly)

All built under `{WHEEBOX_BASE_URL}`:

- Register: `/wheeboxAPI_v2/registration/{companyCode}?val={enc}`
- Assign: `/wheeboxAPI_v2/assignTest/{companyCode}/{enc(loginId)}?val={enc}`
- Test link: `/wheeboxAPI_v2/testlink/{companyCode}/{enc(testNo)}/{enc(loginId)}/{enc(osr)}`
- Authenticate: `/wheeboxAPI_v2/authenticate/{companyCode}/{enc(loginId)}/{token}`
- Verify (browser login): `/LOGIN-2/verifyWBToken.obj?compCode={companyCode}&token={token}`
- Result: `/wheeboxApi/result/{companyCode}/{enc(domain)}/{enc(testName)}/{enc(loginId)}/{enc(osr)}/{enc(dateOfExam)}`

Candidate id = **Application No** (`VDM-…`), matching NPF's "Generate Client Candidate ID From: Application No".

## Encryption (verified correct)

AES-128-CBC, key = `MD5(privateKey)` (16 bytes), IV = `0x00..0x0F`, PKCS7, hex output. Verified byte-for-byte against the API doc's known vector: `john.carter@wheebox.com` + key `8nLNssE3VEyW` → `fe2761cbfa850a8ae7e1879b0c0c979bf650315fa83d23464a42652b20126fa1`.

## IP whitelist — open item for Vercel

Wheebox restricts API calls to **whitelisted caller IPs** (the NPF config whitelisted `35.244.35.71`, NPF's server). Our Next.js API routes run as **Vercel serverless functions, which do not have a fixed egress IP**, so once the base URL is correct Wheebox may still reject our calls on IP grounds. Resolve by either:

1. Asking the Wheebox account manager to disable IP restriction for this account, **or**
2. Giving the Vercel functions a static egress IP (Vercel Secure Compute / a fixed-IP proxy) and whitelisting that IP with Wheebox.
