Current update: public `/api/auth/register` creates member accounts only, applies
per-IP and global throttles, and uses the existing scrypt and cookie-session system.
Administrator bootstrap remains restricted to a server-console link. Comparison API
routes authorize both source jobs on every request; registration runs one at a time.

# Security

What the app protects, how, and what it does not try to do. The app handles
brain MRI of patients, runs a GPU model for whoever uploads, and is reachable
from the internet (Tailscale Funnel, or a university server), so the threats it
is built against are: strangers using it or reading results, one user seeing
another's results, cross-site attacks on signed-in users, crafted files that
exhaust memory or disk, and leaks of internal details.

## Accounts

| | How |
|---|---|
| Who can sign up | Nobody on their own. An administrator makes a **single-use invite link** (1–7 days). The first administrator comes from a one-time link printed to the server console when no account exists. |
| Passwords | scrypt, N = 2^17, r = 8, p = 1, 16-byte random salt (the OWASP Password Storage Cheat Sheet parameters). Parameters are stored with each hash; weaker stored hashes are upgraded at the next sign-in. Passwords are NFKC-normalised, 10–200 characters, not on a short deny-list, and may not contain the username. |
| Sessions | 256-bit random token in a cookie that is `HttpOnly` (scripts cannot read it), `SameSite=Strict`, `Path=/`, and `Secure` over HTTPS. The database stores only the token's SHA-256. Sessions end after 7 days, or 2 days unused (`SESSION_HOURS`, `SESSION_IDLE_HOURS`), at sign-out, when the password changes (all devices) and when an account is disabled. A new session id is issued at every sign-in. |
| Invite and reset links | Random 256-bit token, stored hashed, single use, expiring. The token travels in the URL **fragment** (`/signup#invite=…`), which browsers never send to a server, so it does not reach access logs or `Referer` headers; the page moves it out of the address bar at once. |
| Guessing | Failed sign-ins are limited per account+address (5 / 15 min), per account (20 / 15 min) and per address (40 / 15 min); the nginx config adds 10 sign-ins per minute per address. Unknown usernames cost the same scrypt time as wrong passwords, and both get the same message, so accounts cannot be discovered. |
| Roles | **member**: upload, see own results. **administrator**: also manage the team and open every result. The last active administrator cannot be removed, demoted or disabled. |

The account database is `backend/data/auth.db` (SQLite, owner-only file
permissions on Linux). Command-line management: `python -m app.users --help`.

## Results

- Every job records the account that created it. Status, summary, volumes,
  meshes, voxel look-ups and downloads answer only that account and
  administrators. Someone else's job returns exactly the same `404` as a job
  that does not exist; job ids are 128-bit random.
- Not signed in: `401`, so the web app can offer the sign-in page.
- The curated sample cases (public, de-identified TCIA data) stay open to
  everyone unless `PUBLIC_SAMPLES=0`; they can never be deleted through the API.
- Uploads and results are deleted after `JOB_TTL_HOURS` (24 h).

## Requests

- **Cross-site requests.** Every state-changing API call (`POST`, `PATCH`,
  `DELETE`) must carry `X-Glioma-Client`; a page on another site cannot add a
  custom header without a CORS preflight, which is refused. When the browser
  sends `Origin`, it must be this site (or a configured `CORS_ORIGINS` entry).
  Together with `SameSite=Strict` cookies this blocks CSRF.
- **Order of checks for uploads.** Size limit (before anything is read), then
  the account and quota checks, and only then is the multipart body parsed.
  An anonymous or over-quota upload is refused without being written to disk.
- **Size limits.** `MAX_UPLOAD_MB` (512 MB) per file; the whole upload request
  at most five files' worth, enforced while streaming even without
  `Content-Length`; every other request 64 KB.
- **Quotas.** Per member: 2 analyses waiting or running, 30 per 24 h; the
  server queue takes at most 20 (`MAX_QUEUE`). Administrators are exempt from
  the per-member limits.

## Uploaded files

- **NIfTI headers are checked before any voxel is read.** The matrix size,
  dimensionality and voxel type come from the header, so a small compressed
  file that would expand to gigabytes (a "decompression bomb"), a 4D series or
  an RGB volume is refused without decompressing it. Limits: 3D, 16–1024
  voxels per axis, at most 80 million voxels, plausible spacing, finite values.
- **DICOM zips**: at most 5000 files and 2 GB uncompressed (the zip reader
  enforces the declared sizes), extracted under random names (member names are
  never used, so no path traversal), and deleted right after conversion.
- **De-identification**: every volume is rewritten with a fresh header;
  free-text fields and extensions are dropped; original files and client file
  names are never stored or logged (see ARCHITECTURE.md → Patient data).

## Responses

- Security headers on every response: a strict **Content-Security-Policy**
  (`default-src 'self'`, no inline or remote scripts, `frame-ancestors 'none'`),
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy` and
  `-Resource-Policy: same-origin`, a restrictive `Permissions-Policy`, and HSTS
  over HTTPS. API responses are `Cache-Control: no-store` (image volumes:
  `private`). No `Server` header.
- **No internal details.** A failed analysis tells the user only a reference
  code; the exception (which can hold paths or GPU details) goes to the server
  log under that code. Model-loading errors are shown to administrators only.
  The interactive API docs are off unless `ENABLE_API_DOCS=1`.
- Voxel look-ups refuse non-finite coordinates.

## Deployment

- Docker: the backend runs as an unprivileged user (`glioma`, uid 10001; the
  entry point only fixes the data folder's owner, then drops root for good),
  with `no-new-privileges`. The web container is `nginx-unprivileged` on a
  read-only file system with all capabilities dropped. The API port is bound
  to `127.0.0.1` only.
- nginx: `server_tokens off`, the same security headers on the website, rate
  limits on sign-in and on the API, and it overwrites `X-Forwarded-For` so a
  client cannot pick the address the rate limits see.
- Put HTTPS in front (Caddy, nginx + Let's Encrypt, Tailscale Funnel).
- Dependencies were raised past known advisories in the web stack (FastAPI
  0.120.4 with Starlette 0.49.3 for the multipart and `Range` denial-of-service
  fixes, python-multipart 0.0.22).

## Not in scope

- No email: password resets go through an administrator-made link.
- No two-factor authentication.
- Rate limits are per server process (in memory); they reset on restart.
- The app is a research prototype, not a medical device; it is not certified
  for storing clinical data. Use de-identified data.

## Tests

`backend/tests/test_auth.py` covers hashing, rate limits, invites (single use,
expiry, first administrator), reset links, sessions ending on password change
and disabling, ownership on every job route, CSRF refusal, security headers,
oversized and streamed bodies, the NIfTI decompression bomb, 4D refusal,
hidden internal errors and non-finite voxel look-ups.
