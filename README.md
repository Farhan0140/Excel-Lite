# Household ledger (React + Vite + Tailwind + Neon)

A small spreadsheet for household bills, meter readings and budgets, with accounts and a database.
`household-ledger.html` (the original single file) is kept next to it, unchanged.

## Run it on your computer (no database account needed)

```bash
npm install
npm run dev        # web app  http://localhost:5173   +   API  http://localhost:3001
```

Without `DATABASE_URL` the API uses a real Postgres that runs inside the Node process and keeps its
files in `.data/dev-db`, so you can try sign-up, sign-in and password reset immediately. The console
says `DEVELOPMENT database`. To test on your phone (same Wi-Fi) open the "Network" URL Vite prints.

## Use Neon

1. neon.tech -> create a project -> **Connect** -> switch on **Connection pooling** -> copy the connection string.
2. `copy .env.example .env` and fill it in:
   * `DATABASE_URL` = the Neon string
   * `npm run secrets` prints two random values for `JWT_SECRET` and `RECOVERY_PEPPER`
3. `npm run dev`. The tables (`users`, `workbooks`) are created automatically on first start.

## Deploy (one service: the Node server also serves the web app)

```bash
npm install
npm run build      # type-checks and builds the web app into dist/
npm start          # NODE_ENV=production, needs DATABASE_URL, JWT_SECRET, RECOVERY_PEPPER
```

**Render (free):** push the repo to GitHub, then Render -> New -> **Blueprint** -> pick it. `render.yaml` sets up the build, start command, health check and variables; Render asks you for `DATABASE_URL` and `RECOVERY_PEPPER` and generates `JWT_SECRET` itself. The free plan sleeps after ~15 min idle (the first visit then takes 30-60 s).

Any other Node host works too (Railway, Fly.io, a VPS). Set the three variables from `.env.example`, plus
`TRUST_PROXY=1` when the host puts a proxy in front. Serve it over **https**: the login cookie is `Secure`.
In production the server refuses to start with a missing or short secret.

## How accounts work

| | |
| --- | --- |
| Sign up | email + password (min 8). The server returns a **6 digit recovery code once**; the screen makes you save it |
| Sign in | password is checked against a salted **scrypt** hash. A **JWT** (HS256, 7 days) is set in an **HttpOnly, SameSite=Strict** cookie, so page scripts can never read it |
| Forgot password | email + recovery code + new password. The password changes, **every other session is signed out**, and a **new recovery code** is issued and shown once. The old code stops working |
| Change password / new code | Account panel (needs the current password) |
| Brute force | 5 wrong recovery codes lock resets for 15 min (counted under a row lock, so parallel guesses cannot beat it); 10 wrong passwords lock sign-in for 15 min; per-IP rate limits on top |
| Storage of secrets | passwords: scrypt. Recovery codes: HMAC-SHA256 with `RECOVERY_PEPPER` (a 6 digit code would be cracked instantly if it were only hashed, so a leaked database alone is not enough) |

Email is only a user name: no email is sent and it is not verified, because recovery works with the code.
If someone loses both password and code, the account cannot be recovered.

## How the ledger is stored

`workbooks` holds one row per user: the whole ledger (all tabs, formulas, colours + opacity, merges, column
widths) as `JSONB`, plus a `revision` number. The app is local-first:

* it opens instantly from a copy kept on the device and works offline;
* changes are sent about 1.5 s after you stop typing (and when the page is hidden or back online), retrying with a growing delay;
* every save says which revision it is based on. If the ledger was changed on another device, the save is refused
  (HTTP 409) and the app asks **Use the other version / Keep mine**. Nothing is overwritten silently;
* the server re-validates and normalises everything it stores (sizes, names, colours), never trusting the client;
* signing out removes the device copy; a shared browser never shows another user's ledger (storage is per user).

## Code map

| Path | What it is |
| --- | --- |
| `server/app.ts` | API routes: auth, recovery, workbook. Helmet security headers, rate limits |
| `server/security.ts` | scrypt, recovery-code HMAC, JWT |
| `server/db.ts` | Neon/Postgres (`pg` pool) or the in-process dev database; schema |
| `src/auth/` | sign-in / sign-up / reset screens, recovery-code screen, API client, **sync engine** |
| `src/engine/` | the spreadsheet: formulas, references, copy/paste, tabs, PDF (unchanged behaviour) |
| `src/components/` | UI: menu, toolbar, grid, account panel, guide, theme |

## Scripts

`npm run dev` · `npm run build` · `npm start` · `npm test` (75 tests: engine, server API on real Postgres, sync logic) · `npm run typecheck` · `npm run secrets`
