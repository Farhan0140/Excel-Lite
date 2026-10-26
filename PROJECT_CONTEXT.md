# PROJECT_CONTEXT.md — Household Ledger (Rent Management Excel Lite)

> **Living document.** First written 2026-10-26 after a full read of the codebase; updated 2026-10-26
> (later the same day) for the **multi-page system** feature. Verified facts below were confirmed by
> reading the code and by running `npm test` (134/134 pass), `npm run typecheck` (clean), `npm run build`
> (clean), and a scripted browser session (sign-up → pages → duplication → reload → 320px layout) on the
> current tree. Secrets in `.env` were inspected by variable name only — no values are reproduced anywhere.

---

## 1. What this project is

A **local-first, offline-capable mini spreadsheet** ("Household Ledger", npm name `household-ledger`,
v2.0.0) for tracking household bills, meter readings and monthly budgets, with real formulas, multiple
tabs, cell formatting, PDF/JSON export, user accounts, and cross-device sync.

**Pages**: since the 2026-10-26 multi-page feature, a workbook contains up to 40 **pages**, each holding
up to 40 **tabs**. Pages are navigated from a toolbar control (prev / current page / next; double-click
the number to rename) and managed from the menu's Pages section, which holds **actions only** — New page,
Duplicate page, Rename page, Delete page. **Tab names are unique within a page and may repeat across
pages** (a duplicated page is an exact twin: same tab names, same page name). A formula reference
resolves against the formula's own page first, then falls back to the first same-named tab anywhere —
so a twin reads its own tabs, and a name its page lacks still reaches other pages. A same-named local
tab therefore *shadows* the global one. Page names are stored labels (unnamed pages display "Page N" by
position; duplicated twins of renamed pages keep the name). Deleting a page removes the page you are on
with all its tabs (undoable; refs resolving to its tabs become #REF!).

Key design decision: **the on-device copy is the source of truth**. Every read/write goes through a
synchronous KV surface backed by real SQLite (sql.js/WASM in the browser, snapshot-persisted to
IndexedDB + a synchronous localStorage mirror). `SyncManager` pushes the whole workbook to the server
in the background with revision-based optimistic concurrency. The server (Express + Postgres) is a
sync/auth endpoint, never a requirement for using the app.

There is also a **legacy single-file version** (`household-ledger.html`, v1, ~73 KB, self-contained),
kept unchanged. It uses storage keys `household-ledger-v1`/`-v2` in plain localStorage; the new app
migrates ("takes over") those keys the first time a new account has no server data.

## 2. Technology stack

| Layer | Technology |
|---|---|
| Frontend | React 19.3, TypeScript (strict), Vite 8, Tailwind CSS 4 (`@tailwindcss/vite`), lucide-react icons |
| Fonts | Self-hosted `@fontsource/instrument-sans` + `@fontsource-variable/bricolage-grotesque` (PDF draws with "Instrument Sans") |
| Local data | sql.js 1.14 (SQLite→WASM) over a KV table; snapshots to IndexedDB; synchronous localStorage mirror (`hlmirror:` prefix) |
| Sync/auth client | `fetch` wrapper (`src/auth/api.ts`); JWT in HttpOnly SameSite=Strict cookie (web) or `Authorization: Bearer` (native) |
| PWA | vite-plugin-pwa 1.3 (workbox, precache, `registerType: 'prompt'`, SW registered manually) |
| Backend | Express 5.2 on Node ≥20 (tsx runner), helmet, express-rate-limit, zod 4 validation |
| Auth crypto | Node `crypto` scrypt (N=32768,r=8,p=3), HMAC-SHA256 (recovery codes, peppered), `jose` JWT HS256 |
| Database | PostgreSQL (Neon) via `pg`, JSONB workbook column; **dev/test** uses PGlite 0.5 (real in-process Postgres, no install) |
| Tests | Vitest 5, node environment — 4 suites, **120 tests, all passing** (verified 2026-10-26) |
| Deploy | Render Blueprint (`render.yaml`): one Node service serves API + built `dist/`; `/api/health` health check |

**Notable:** the server imports `cleanWorkbook` from `../src/engine/model` — validation logic is
**shared** between client and server (single source of truth for what a valid workbook is).
`tsconfig.server.json` compiles only `server/` + `src/engine/{types,model,refs}.ts`, which is exactly
the shared surface.

## 3. Folder structure

```
Rent_Management_Excel_Lite/
├── server/                       Express API (TypeScript, run with tsx)
│   ├── index.ts        (31)      Entry: load .env → loadConfig → connectPglite/connectPostgres → migrate → createApp → listen; SIGINT/SIGTERM graceful stop
│   ├── config.ts       (52)      env → Config; throws in production if DATABASE_URL/JWT_SECRET/RECOVERY_PEPPER missing or <32 chars; dev falls back to insecure defaults with a warning
│   ├── db.ts           (96)      Db interface {kind, query, tx, close}; connectPostgres (pg.Pool max 5, strips channel_binding, idle-error handler), connectPglite (PGlite), SCHEMA + migrate() (idempotent, runs every start)
│   ├── security.ts     (65)      hashPassword/verifyPassword (scrypt, NFKC-normalized, params embedded in stored string), newRecoveryCode (6-digit), recoveryDigest (HMAC-SHA256 pepper), safeEqualHex, signSession/readSession (JWT HS256, issuer household-ledger, payload {sub, ver})
│   ├── app.ts          (331)     createApp(db, cfg): helmet, rate limits, zod schemas, all routes, auth middleware, workbook upsert, static serving, error handler
│   └── server.test.ts  (348)     31 tests: real PGlite engine + tiny cookie-jar fetch client
├── src/                          React web app
│   ├── main.tsx        (17)      fonts → index.css → initPwa() → <Root/> in createRoot (StrictMode)
│   ├── App.tsx         (170)     Authenticated shell: page-level event wiring, panels, conflict banner, PWA banner, keyboard mode
│   ├── store-context.tsx (10)    StoreContext + useStore(); useStoreSync = useSyncExternalStore(store.subscribe, store.getSnapshot)
│   ├── theme.ts        (70)      useTheme(): mode system/light/dark × 8 palettes; sets data-mode/data-palette on <html>, theme-color meta; persisted to localStorage 'household-ledger-theme'
│   ├── pwa.ts          (37)      initPwa/pwaUpdate — manual registerSW, needRefresh/offlineReady flags (offer reload, never force)
│   ├── index.css       (186)     Tailwind 4 @theme tokens; palettes defined as --h/--c hue+chroma pairs → oklch vars; dark mode via [data-mode="dark"]; fill colours --f1..--f8; grid styles
│   ├── auth/
│   │   ├── api.ts      (81)      ApiError (status 0 = network); configureApi/setAuthToken (native-app hooks); api object: me/signup/signin/signout/reset/changePassword/newRecoveryCode/getWorkbook/putWorkbook (body pre-serialised JSON)
│   │   ├── sync.ts     (238)     scopedStorage/clearScoped (per-user `hl:<id>:` prefix); bootstrap() decides what to open with; bootFromBackup; SyncManager (debounce 1.5 s, backoff 3/8/20/45/60 s, conflict+expired states, useServerVersion/keepMine)
│   │   ├── wakeServer.ts (40)    retryUntilOk + looksLikeColdStart (retry only network errors and 5xx, ≤120 s, delays 500ms→8s) — used for the initial /me call only
│   │   ├── Root.tsx    (257)     App root state machine: loading→waking→offline→anon→code→authed; opens SQLite first; Session component builds Store+SyncManager; cached user 'hl-last-user'; "Open backup" recovery path
│   │   ├── AuthScreen.tsx (207)  AuthShell/Field/Submit/ErrorNote shared UI; AuthScreen (signin/signup/forgot modes)
│   │   └── RecoveryCode.tsx (79) RecoveryCodeBox (big code, copy+download txt) + RecoveryCodeScreen (must check "I have saved" to continue)
│   ├── storage/
│   │   └── sqlite.ts   (148)     initSqlStorage(): sql.js DB in memory; kv table; debounced (400 ms) snapshot → IndexedDB 'household-ledger-sql'; synchronous localStorage mirror 'hlmirror:*' replayed on boot and cleared after confirmed export; flush() on pagehide/visibilitychange
│   ├── engine/                   The spreadsheet core (no React imports)
│   │   ├── types.ts    (30)      Cell{v,b,f,o?}, Merge, SheetData, Sheet, Page{cur,sheets}, Workbook{curPage,pages}; limits MAXR=1000, MAXC=60, MAX_TABS=40, MAX_PAGES=40, FILL_COUNT=8, DW=118, LW=140
│   │   ├── refs.ts     (119)     key/colName/colIdx/ref/parseNum/fmt; ref-rewrite regex RE; xform(f,map); rewriteSheet; canonSheets; shiftMap/insMap/delMap; expandFetcher (row_sum/col_sum → real =SUM())
│   │   ├── formula.ts  (248)     Evaluator class over all PAGES: tokenizes & parses =..., recursive descent; memo cache + visiting set (#CIRC!); SUM/AVG/AVERAGE/MIN/MAX; errors #DIV/0! #VALUE! #REF! #NAME? #CIRC! #ERR! #NUM!. Tab refs resolve against the formula's own page first, then the first same-named tab anywhere (page-local shadowing)
│   │   ├── model.ts    (286)     blank/setCell (cell auto-deleted when empty & unstyled)/cloneCell; TEMPLATES (meter, budget) + place/sampleData/sampleWorkbook; loadWorkbook/saveWorkbook (pages format with names; migrates legacy {cur,sheets} → 1 page, and v1 → same); cleanData/cleanWorkbook (server-side normaliser — pages shape AND legacy shapes; sheet names deduped per page, duplicates across pages allowed); workbookFromBackup/backupText (v3 with curPage/pages)
│   │   ├── store.ts    (1436)    Store class — the central non-React state manager (see §6.1); page navigation/gotoPage, addPage (starts from Tab1), duplicatePage (exact twin), deletePage, page rename; resolveSheetFor mirrors the evaluator's page-local resolution for every rewrite
│   │   ├── palette.ts  (13)      FILLS 1..8 light/dark hex; PDF_FILL (always light)
│   │   ├── pdf.ts      (203)     buildPdf(pages, list): plans pages (scale 0.6–0.9, landscape when too narrow, splits columns/rows at merge boundaries, ≤300 pages), draws each page on canvas ×3 zoom → JPEG → hand-built PDF 1.4 bytes (no library)
│   │   ├── download.ts (17)      downloadFile(blob/name/type) via <a download>
│   │   ├── engine.test.ts (681)  62 tests incl. the 'pages' suite (exact-twin duplication, page-local shadowing/resolution, page rename/delete, caps, migration, storage round trip); confirm.test.ts (336) 30 tests for the confirm-mode layer
│   ├── components/
│   │   ├── Grid.tsx    (198)     memoized <table>; full re-render on ver change (disp useMemo per ver); merged-cell rowSpan/colSpan; fill opacity via --fc/--fo; Sheet wrapper wires mouse/keyboard/drag-resize to Store. Uses store.flat (index into the flattened all-sheets array) for the Evaluator
│   │   ├── Bars.tsx    (180)     Header, TabBar (tabs of the CURRENT page only; rename input; double-click to rename), StatusBar (Sum/Avg of selection), Toast
│   │   ├── Toolbar.tsx (313)     undo/redo, PageNav (prev ‹ n/N › next with inline rename input, disabled ends dim to the muted colour), copy/paste/range-select/bold/fill picker (opacity slider)/cells menu/confirm-mode toggle; FillPicker + CellsMenu popovers
│   │   ├── Editing.tsx (180)     EditInput (shared by floating cell editor and formula bar, caret management, beforeinput auto-pair); CellEditor; FormulaBar; SuggestBar (function/tab suggestions + phone symbol keys)
│   │   ├── AccountPanel.tsx (187)/ SYNC_TEXT map; useSyncStatus; SyncDot; password change, new recovery code, sign-out (flush-first, two-step if dirty)
│   │   ├── MenuPanel.tsx (132)   grouped menu → Store methods; "Pages" section holds actions only: New page, Duplicate page, Rename page, Delete page
│   │   ├── ThemePanel.tsx (84)   mode + 8 palette previews
│   │   ├── GuideModal.tsx (598)  16-section in-app guide (static content; not yet updated for pages)
│   │   ├── ConfirmModal.tsx (68) renders store.pending as modal; swallows all keys; focus Cancel on danger
│   │   └── ui.tsx      (81)      IconButton, Sep, Popover ('sheet'|'drop'), PanelTitle
│   └── hooks/
│       ├── useKeyboardMode.ts (68) phone keyboard detection via visualViewport; sets --vh; returns kb flag ( hides chrome, keeps grid+formula bar)
│       └── useUnsavedGuard.ts (36) beforeunload when editing/pending/dirty; commits edit on visibilitychange/pagehide (Chrome Android workaround)
├── public/                       favicon.svg, manifest.webmanifest, theme-init.js (pre-paint theme, reads 'household-ledger-theme'), sql-wasm-browser.wasm (sql.js asset)
├── household-ledger.html         Legacy v1 single-file app (untouched; keys v1/v2 = migration source)
├── index.html                    Vite entry; links manifest, favicon, theme-init.js
├── vite.config.ts                react + tailwind + VitePWA plugins; /api proxy → localhost:3001; vitest config (node env)
├── tsconfig.json / tsconfig.server.json   Strict, noEmit; server config includes only the 3 shared engine files
├── render.yaml                   One-service Render Blueprint (NODE_VERSION 22, TRUST_PROXY=1, DATABASE_URL + RECOVERY_PEPPER sync:false, JWT_SECRET generated)
├── .env.example                  Template (DATABASE_URL, JWT_SECRET, RECOVERY_PEPPER, optional PORT/SESSION_DAYS/TRUST_PROXY/COOKIE_SECURE)
├── .env                          Real values (NEVER commit; .gitignore covers it)
├── dist/                         Build output (git-ignored; stale artifact present)
├── .data/                        Empty; PGlite dev DB dir (default .data/dev-db) is created on first dev server run
└── .claude/                      Empty directory
```

Git: current branch **`Page`** (local only; remote is `origin/main`), clean tree at analysis time.

## 4. Architecture & data flow

```
┌─────────────────────────── Browser / Phone ────────────────────────────┐
│  React UI (components/)                                                │
│      │ useStoreSync (useSyncExternalStore on store.tick)               │
│  Store (engine/store.ts)  ── owns Workbook, sel, history, confirm gate │
│      │ onPersist (every kept change)                                   │
│  SyncManager (auth/sync.ts) ── status machine + revision bookkeeping   │
│      │ putWorkbook(snapshot, baseRevision) via api.ts                  │
│  sql.js KV (storage/sqlite.ts)  ←→  IndexedDB snapshot + hlmirror      │
└──────────────────────────────┬─────────────────────────────────────────┘
              /api (cookie or bearer, retried with backoff; cold-start wake loop for first /me)
┌──────────────────────────────┴─────────────────────────────────────────┐
│  Express app.ts → helmet → rate limit → routes → error handler         │
│      zod validation → cleanWorkbook(src/engine/model.ts — shared code) │
│      pg.Pool → Postgres/Neon  (or PGlite in-process for dev/tests)     │
│      users (auth+lockouts) / workbooks (jsonb, revision)               │
└────────────────────────────────────────────────────────────────────────┘
```

Local persistence layers (all sync-API, same shape): **SQLite kv table** (write-through) → **localStorage
`hlmirror:` mirror** (synchronous crash backstop) → **IndexedDB snapshot** (debounced 400 ms export,
flushed on pagehide/visibilitychange). Scoped per user by `hl:<userId>:` prefix (`scopedStorage`).
Plain (unscoped) localStorage is only used for: theme, cached user `hl-last-user` (and the legacy
migration source). UI prefs (`household-ledger-ui`) live in the *scoped* store because `Store` receives
the scoped kv from `Session`.

Keys inside scoped storage: `household-ledger-v2` (workbook JSON — the multi-page `{curPage, pages}` shape),
`sync-rev`, `sync-dirty`, `household-ledger-ui`. `hl-last-user` is on the *unscoped* store. NOTE: the
Evaluator inside the Store is built from **all sheets of all pages flattened** (`store.allSheets()`); the
`si` index it takes is the position in that flat array, exposed as `store.flat` for the current sheet.

## 5. Backend reference (server/)

### Config (`config.ts`)
`loadConfig()` → `{ prod, port(3001), databaseUrl?, pgliteDir(.data/dev-db|memory), jwtSecret,
recoveryPepper, sessionDays(7), cookieSecure(prod default true), trustProxy, staticDir(dist),
rateLimit(unless RATE_LIMIT=off), hash: undefined }`. Production throws if `DATABASE_URL`,
`JWT_SECRET`, or `RECOVERY_PEPPER` absent/short (<32). Dev substitutes insecure defaults with a
console warning. `cfg.hash` (tests only) allows weak scrypt params.

### Database (`db.ts`)
- `users`: id uuid PK, email (unique on `lower(email)`), password_hash, recovery_hash, token_version,
  pw_failed, pw_locked_until, recovery_failed, recovery_locked_until, created_at, updated_at.
- `workbooks`: user_id uuid PK → users(id) ON DELETE CASCADE, data jsonb, revision int default 1, updated_at.
- `migrate()` runs idempotently on every start. `Db.tx()` wraps a callback in begin/commit/rollback.

### Security (`security.ts`)
- **Passwords**: scrypt N=32768 r=8 p=3 (OWASP), 16-byte salt, 64-byte key, NFKC-normalized, stored as
  `scrypt$N$r$p$saltB64$hashB64`; `verifyPassword` validates params before use; timing-safe compare.
- **Recovery codes**: 6-digit, 1,000,000 possibilities → stored only as `HMAC-SHA256(pepper, userId+":"+code)`.
- **Sessions**: JWT HS256, issuer `household-ledger`, payload `{sub: userId, ver: tokenVersion}`, exp `<sessionDays>d`.
  `token_version` bump invalidates all previous tokens (used by password change/reset).

### Routes (`app.ts`) — all under `/api`, `Cache-Control: no-store`
| Method/Path | Rate limit | Body (zod) | Behaviour |
|---|---|---|---|
| GET `/health` | none | — | `{ok:true}` |
| POST `/auth/signup` | 20/h + IP | email, password(8–128) | create user; 409 `email_taken` (unique index collides → PG 23505); returns `{user, recoveryCode, token}`; starts cookie + bearer token session |
| POST `/auth/signin` | 30/15m | email, anyPassword | row-lock tx; unknown email → scrypt against a cached dummy hash (timing parity), same 401 message; lockout 10 wrong pw → 15 min; success bumps nothing, returns user+token |
| POST `/auth/signout` | none | — | clears cookie (`{ok:true}`) |
| GET `/auth/me` | (auth) | — | `{user:{id,email}}`; 401 unless valid cookie/bearer and `token_version` matches |
| POST `/auth/reset` | 15/15m | email, code(6 digits), newPassword(8–128) | row-lock tx; lockout 5 wrong codes → 15 min (`recovery_failed` counted under `FOR UPDATE`, race-proof); on success: new password, **new recovery code**, `token_version+1` (signs out other devices); returns new code + token |
| POST `/auth/password` | 20/15m, auth | currentPassword, newPassword | verifies current; `token_version+1`; new session token |
| POST `/auth/recovery-code` | 20/15m, auth | password | verifies password; rotates `recovery_hash`, resets counters; returns the new code (shown once) |
| GET `/workbook` | 600/15m, auth | — | `{data, revision, updatedAt}` or `{data:null, revision:0}` |
| PUT `/workbook` | 900/15m, auth (8 MB json) | baseRevision int≥0, force?, data | `cleanWorkbook(data)` (server never trusts client — caps sizes, strips invalid cells; accepts the current multi-page shape `{curPage, pages}` AND the legacy `{cur, sheets}`/single-SheetData one); **atomic upsert**: `insert ... on conflict (user_id) do update ... where workbooks.revision = $base or $force` → either revision increments and row is returned, or **no row returned → 409 `conflict` with `{revision: current}`**; first save (no row) always inserts with revision 1 |

Fallbacks after `/api`: static serving of `cfg.staticDir` (assets immutable 1y; index.html no-cache
fallback for GET/HEAD). Error handler maps `HttpError` → `{error:{code,message}, ...extra}`; body too
large → 413; malformed JSON → 400; anything else logged + 500.

Hardening: helmet CSP (no inline scripts in build), HSTS + upgrade-insecure-requests when `cookieSecure`
(https), per-IP rate limits with 429 JSON, 16 KB json limit on auth routes vs 8 MB on workbook PUT.

## 6. Frontend core

### 6.1 Store (`src/engine/store.ts`) — the single mutable state manager
Not a React component; React reads it through `useSyncExternalStore` with three version counters:
- `tick` — bumped on *every* `emit()` (fine-grained subscription anchor);
- `ver` — cell/data/structure changes (Grid recomputes display matrix per ver);
- `selVer` — selection changes; `wver` — widths/size.

Core mechanics:
- **Mutation + history**: `mutate(fn)` = `pushHist()` (snapshot JSON, cap 100, clears future) → `fn()` →
  `save()` (writes scoped storage + calls `onPersist`) → `refresh()` (re-derive merges, drop Evaluator
  cache, bump ver/selVer/wver, emit). `undo()/redo()` swap whole-workbook snapshots (`restoreSnap`).
- **Confirm gate** (`gate`): while `confirmMode` (default on, persisted) every destructive/normal change
  becomes `pending` (described modal); `ConfirmModal` renders it; only one pending at a time; edit gets
  blocked while one waits. `confirm.test.ts` (30 tests) covers this layer.
- **Pages** (`gotoPage/addPage/duplicatePage/deletePage/startPageRename/finishPageRename`): the workbook
  is `{curPage, pages:[{name?, cur, sheets}]}`. Store exposes `page/sheets/cur` getters bound to the
  **current page** plus `allSheets()` (flat, cross-page) and `flat` (current sheet's index in it) for the
  Evaluator. **Tab names are unique per page, not globally** (`uniqueName` checks `page.sheets`; new
  pages start from their own `Tab1`), and `resolveSheetFor(fromSheet, name)` mirrors the evaluator's
  resolution for every rewrite: same-named tab of the formula's own page first, then first match
  anywhere. `duplicatePage` is an exact twin — every tab keeps its name and every internal formula its
  text, because page-local resolution already binds the twin's formulas to its own tabs; external refs
  survive via the global fallback. Page names are labels (page-local display names; a renamed name
  carries to the twin, an unnamed page stays position-numbered "Page N"; clash-suffixed renames as with
  tabs). Page/tab switching is navigation (no history entry; restores the page's remembered tab +
  selection). `deletePage` removes the page you are on behind the danger gate (last page blocked;
  `rewriteAll` #REF!s every ref *resolving to* its tabs by identity); add/copy/rename are one undo step
  each, not confirm-gated.
- **Editing**: `startEdit/commitEdit/cancelEdit/retarget` (retarget keeps the phone keyboard open);
  formula bar and cell editor are the same `editText` state via `EditInput`; suggestions (`sugItems`)
  and `autoPair` bracket handling; `expandFetcher` turns `row_sum`/`col_sum` into a real `=SUM(range)`.
- **Structure ops**: `insertRows/insertCols/deleteRows/deleteCols` all: `remap` cells → resize grid →
  `xformAll(map)` (rewrites formulas on **every** tab, only for refs resolving to the edited sheet) →
  `adjMerges` → gate → mutate. `deleteTab` is two-step armed (`delArm`, 4 s timeout), other tabs' refs →
  `#REF!` via `rewriteAll`. `finishRename` rewrites all formulas to the new name (case-insensitive match,
  dedupe with `uniqueName`).
- **Copy/paste**: internal `Clip` (cells+merges+TSV); `pasteClip` repeats the block when the target
  selection is an exact multiple; relative refs shift via `xform(v, shiftMap)`, absolute stay;
  `pasteText` accepts TSV; system clipboard `onDocCopy/onDocPaste` interop (uses TSV of *display* values).
- **Merges**: `cover` Map cell→merge for O(1) lookup; `rng()` expands selection over merges (iterate to
  fixpoint); merge deletes non-top-left cells; snap() maps any cell in a merge to its top-left.
- **Backups/PDF**: `saveBackup` (JSON download), `openBackupText` (gated replace, undo-able),
  `readBackupFile` (≤20 MB), `exportPdf(all)` (busy flag, ≤300 pages).
- `confirmMode`/`fillOpacity` persisted under `household-ledger-ui` **inside the scoped storage**.

### 6.2 Formula engine (`formula.ts` + `refs.ts`)
The `Evaluator` is constructed from the workbook's **pages**: it flattens them to `sheets` while keeping
page boundaries (`pageEnd` prefix sums), so `resolveSheet(name, si)` can resolve a tab name against the
formula's own page first and fall back to the first same-named tab anywhere (`#REF!` when none) — this
is what makes duplicated pages work with unchanged formulas. Tokenizer regex → tokens (num | ref | ref! |
fn | op). Recursive-descent parser: `expr` (+/−) → `term` (*//, ÷ by 0 → #DIV/0!) → `unary` (±) →
`primary` (number, parenthesised expr, cell/range ref, fn call). Range refs expand to arrays; `callFn`
flattens numbers from arrays (SUM/AVG/AVERAGE/MIN/MAX; unknown → #NAME?). Numbers parse leniently
(`parseNum`: commas, leading currency symbols). Text in arithmetic → #VALUE!; unknown sheet → #REF!;
cycle → #CIRC!; malformed → #ERR!; non-finite → #NUM!. `Evaluator` caches per-cell results, throws
cached Errors, and detects cycles with a `visiting` set. Ref-rewriting utilities (`xform` + RefMap) power
copy/fill/insert/delete/rename/sheet-canonicalisation; `$` absolute parts never move; out-of-range →
`#REF!` in the formula string.

### 6.3 Storage (`storage/sqlite.ts`)
`initSqlStorage()` → `SqlKV` (sync getItem/setItem/removeItem/length/key + async `flush()`). Writes go
to the SQLite kv table *and* the localStorage mirror; export to IndexedDB is debounced (400 ms) and on
pagehide/visibilitychange; on boot, mirrored keys are replayed over the reconstructed snapshot, then
cleared only after their containing export succeeds. `Root.tsx` falls back to `memoryKV()` if init
fails (app still runs, just no offline copy).

### 6.4 Sync (`auth/sync.ts`)
`bootstrap(api, kv, legacy)` decision table:
| Server reachable? | Server data | Local state | Boot |
|---|---|---|---|
| no | — | has local copy | local copy, revision localRev, status `offline` |
| no | — | no local copy | throws network error → Root shows "You are offline" screen |
| yes | none | local copy exists | local copy, dirty, `pending` (upload) |
| yes | none | legacy keys (v1 app) | legacy take-over, `fromLegacy` (deleted after first save) |
| yes | none | nothing | sampleWorkbook, dirty, `pending` |
| yes | data | local dirty | local wins for now; `pending` if revisions equal, else `conflict` |
| yes | data | clean | server copy, `saved` |

`SyncManager` states: `saved | pending | saving | offline | error | conflict | expired`.
`touch()` (wired to `store.onPersist`): marks dirty, schedules 1.5 s debounce (200 ms if edited again
during save). `save()` sends the **whole workbook snapshot** with `baseRevision` (idempotent replay:
same base+data → server returns same revision, so duplicate pushes are harmless). 409 → `conflict`
(status from `e.extra.revision`); 401 → `expired` + `onExpired` (Root shows anon screen with notice);
network/other → `offline`/`error` with backoff 3/8/20/45/60 s. Conflict exits: `useServerVersion()`
(pull + replaceWorkbook) or `keepMine()` (force put). Listens to online/pagehide/visibilitychange.

### 6.5 Auth flow (`Root.tsx`)
`Root` = phase machine: open SQLite → `api.me()` (direct 401 → anon; network-but-offline → cached user
or offline screen; cold-start-looking → `retryUntilOk` wake loop ≤2 min, then cached user or offline;
exhausted → cached/offline). `Session` (keyed by user id) builds scoped kv, `bootstrap`s, constructs
`Store` + `SyncManager`, renders `App`. Sign-out: flush first; if dirty, two-step button ("Sign out
anyway"); clean sign-out clears scoped storage; network failure blocks sign-out with a message.
Recovery paths: `bootFromBackup` (Session-level "Open backup" when ledger fails to open) and the
v1-legacy take-over after first upload.

### 6.6 UI wiring (`App.tsx` + components)
`App` owns: page-level listeners (doc mousedown commits edit, copy/paste, drag-drop backup), keyboard
mode (`useKeyboardMode`), unsaved guard (`useUnsavedGuard`), panel state (`top`: menu/theme/guide/account;
`tool`: fill/cells), PWA banners, conflict banner (only visible surface choosing useServerVersion/keepMine).
Everything hides while the phone keyboard is up except formula bar, (fx) suggestions and TabBar.

## 7. Business rules & invariants (verified in code)

1. **Workbook JSON shape** (types.ts): `{cur, sheets:[{name, data:{rows,cols,cells:"r,c"→Cell, colW, merges}}]}`.
   Limits: 1000 rows, 60 cols, 40 tabs, 30-char names, name charset forbids `!`: `'` (used as ref
   separator), value ≤2000 chars, colW 50–500, fill 1–8, opacity 10–100 (100 = default = omitted),
   merges clamped, de-overlapped. `cleanWorkbook` enforces all of it on backup-open AND on every
   server PUT (server response of first save = revision 1).
2. **Cell identity**: a cell that is empty, non-bold, uncoloured is *deleted* from the map (`setCell`).
3. **Revision discipline**: local copy always stores the server revision it derives from (`sync-rev`);
   dirty flag (`sync-dirty`) survives reloads; a boot with dirty local + newer remote → user must choose
   (never silent overwrite). Force-put only via `keepMine`.
4. **Everyone-gets-signed-out rule**: password change/reset bumps `token_version`; sessions carry `ver`.
5. **Recovery-code rotation**: every successful reset and every manual new-code generation invalidates
   the previous code. Code shown exactly once, permissive screen requires "I have saved" tick.
6. **Lockouts**: 5 wrong recovery codes / 10 wrong passwords → 15-minute lock, counters reset on success
   or lock (row-locked so parallel guesses can't race).
7. **Undo model**: whole-workbook snapshots, cross-tab, covers structural ops and merges; cap 100;
   new history on `replaceWorkbook` (fresh from server/backup).
8. **Confirm mode default on**: every grid mutation that changes data goes through `gate()` except
   pure navigation/format-picker preview… (in practice: all mutations except `setColWidth`).
9. **Save semantics**: `Store.save()` always writes the local SQLite copy; `onPersist` fires the SyncManager
   debounce. Sync sends entire snapshot (no op log to dedupe).
10. **Enumeration safety**: wrong password and unknown email produce identical 401 + comparable timing
    (dummy scrypt evaluated for unknown emails).
11. **Pages**: ≤ `MAX_PAGES` (40) pages, ≤ `MAX_TABS` (40) tabs *per page*. **Tab names are unique per
    page, not globally** — `addTab`/`copyTab`/`uniqueName`/renames check only the current page, new pages
    start from their own `Tab1`. Because of that, references are ambiguous across pages whenever two
    pages hold the same name: the evaluator (and every rewrite, via `resolveSheetFor`) resolves **the
    formula's own page first**, then the first same-named tab anywhere. A local same-named tab shadows
    the global one, so after duplicating a page you cannot reference the *original's* same-named tabs by
    name (rename one side to disambiguate). `insertRef` inserts names without a page qualifier, which
    resolves like any formula. Page names are stored labels — unnamed pages display "Page N" from
    position; renamed names carry to twins; clashing renames get the `…2` suffix; display-name clashes
    between pages are allowed at load. A page can never lose its last tab, and the last page cannot be
    deleted ("You need at least one page.").
12. **Format migration, never rejection**: legacy local copies / server data / backups (`{cur, sheets}`
    or one bare SheetData, including the pre-account v1 single-file app) are wrapped as a single
    "Page 1" with their `cur` preserved, on load and on every server write. The `Store` constructor
    normalises any workbook handed to it via `cleanWorkbook`, so test fixtures and callers may use
    either shape. Page `name` is optional everywhere: old data without names just displays "Page N".
13. **Page-name plumbing & resolution consistency**: page names must flow through every channel —
    `saveWorkbook`, `snapshot`/`restoreSnap`, `backupText`, `cleanWorkbook`/`pagesFrom` — or they are
    lost silently on undo/backup/reload (two such bugs were caught by tests). Tab-name dedupe in
    `cleanWorkbook` is per page (cross-page duplicates are the point now). EVERY tab-name rewrite
    (`xformAll`, `deleteTab`, `deletePage`, `finishRename`) must resolve references through
    `resolveSheetFor` (page-local-first, identity-compared) — plain name matching breaks shadowed pages.
    The `pages` engine tests pin all of this (exact twins, shadowing, renames, cross-page #REF!) — rerun
    them before touching resolution or duplication logic.

## 8. Critical execution paths (traced)

**Edit a cell (web):** keystroke on grid → `onGridKeyDown` → `startEdit(char)` → typing updates
`editText` (EditInput onChange → `setEditText`); Enter → `commitEdit` → `applyEdit` (expands fetchers /
canonicalises cross-tab names; skipped if unchanged) → `gate` (confirm modal or immediate) → `mutate`
→ `setCell` → `save()` → SQLite write (+localStorage mirror, schedule IndexedDB flush) → `onPersist` →
SyncManager `touch()` → 1.5 s timer → `flush()` → PUT `/api/workbook` with full snapshot + baseRevision
→ server `cleanWorkbook` + atomic upsert → `{revision}` → local revision/dirty updated. Undo stacks up
to 100 whole-workbook snapshots along the way.

**First visit cold server:** `Root` mounts → SQLite opens (sidebar: replay mirror) → `api.me()` fails
with network/5xx → phase `waking` → `retryUntilOk` (500ms→8s, ≤120 s) → success → `authed` or 401 →
`anon` → AuthScreen → signin → `finish()` → authed → `Session` → bootstrap → Store + SyncManager → App.

**Offline conflict:** edits made while server unreachable → status `offline`, backoff retries; meanwhile
another device saves → local PUT finally succeeds but 409 (server revision moved) → `conflict` status →
red banner in `App` → choose `useServerVersion()` (pull) or `keepMine()` (force) → back to `saved`.

**Password reset:** forgot form → POST `/auth/reset` → row-locked, code checked against HMAC → rotate
password + code, bump token_version → response includes the *new* code once → RecoveryCodeScreen →
`authed`. All earlier tokens (other devices) now 401 → their SyncManager flips to `expired` → Root's
onExpired → anon screen with notice, local copy kept (so nothing is lost).

**Multi-page lifecycle:** Menu "New page" → `Store.addPage()` (undoable) → toolbar shows `2/2`, TabBar
rescopes to the new page's own `Tab1`. Arrows → `gotoPage(i)` (commits any edit, stashes the current
selection, lands on that page's remembered tab + selection). Menu "Duplicate page" → `duplicatePage()`:
deep-JSON-clone every tab **keeping its name** (and the page's name) and switch to the twin — no formula
rewriting at all; page-local resolution binds the twin's formulas to its own tabs, external refs fall
through globally. Menu "Rename page" → inline toolbar input (Enter/blur saves, Escape cancels; display
names dedupe with the `…2` idiom). Menu "Delete page" → danger gate → splice + identity-based `#REF!`
rewrite + one undo step. The whole state (pages incl. names, per-page tab, curPage) is part of every
autosave + snapshot, so it survives reload, undo/redo, and server sync unchanged.

## 9. Verified project state (2026-10-26, after the multi-page feature landed)

- `npm test` — **4 files, 141 tests, all passing** (engine 63 incl. the `pages` suite with exact-twin
  duplication and page-local shadow tests, confirm 30, server 31, sync 17). README says "75 tests" —
  the suite has long outgrown that number (docs drift).
- `npm run typecheck` — clean (both tsconfig projects). `npm run build` — clean (PWA precache generated).
- **Browser-verified end to end, three times** (Vite + API dev servers):
  pass 1 (initial multi-page build): sign-up → grid; page control `‹ 1/3 ›` beside Undo/Redo; New page
  → `2/2` with TabBar rescope; typing with the confirm modal; prev/next navigation; Duplicate page →
  `3/3`; hard reload → same page/tab, sync "all changes saved"; 320×640 → `scrollWidth == 320`.
  pass 2 (menu-as-actions revision): Menu Pages section = New / Duplicate / Rename / Delete only;
  Rename page → inline toolbar input → "Home" sticks; Duplicate → `Home_copy` at `4/4`; Delete → danger
  modal → confirm → back to `3/3`; reload persists both rename and delete; 320px overflow-free.
  pass 3 (exact-twin duplication): Duplicate on the "Home" page → twin with the SAME tab names
  (`Tab1`, `Tab2` — nothing renamed) and same page name; twin computed "Total bills 99.3" from its own
  tabs; editing the twin's current reading → its totals moved (120), page 1 still 22.5/99.3; reload →
  all 6 pages persisted, "all changes saved".
- `npm audit` — 11 advisories (2 critical, 4 high, 4 moderate, 1 low), all fixable via `npm audit fix`:
  runtime-relevant ones are **body-parser** (high, DoS via trailing bytes after compressed request body —
  Express dependency) and **zod** (moderate, memory exhaustion on oversized constrained collections —
  used on public API routes); the rest are dev tooling (vitest mocker, shell-quote, serialize-javascript,
  fast-uri, ip-address…). **Not fixed** (feature work took priority; still pending).
- Git: feature implemented on branch `Page` (uncommitted working tree at last check); `dist/` rebuilt
  locally, ignored by git. `.data/` now holds a dev PGlite database with the browser-test account.

## 10. Areas requiring extra caution when modifying

1. **`src/engine/model.ts` (`cleanWorkbook`/`cleanData`)** — shared by browser (backup open) *and* the
   server PUT validation. A looser change here changes what anyone can save; a stricter
   one can brick older clients' data on next sync. Keep its `tsconfig.server.json` dependency set in mind
   (model.ts must not import DOM code).
2. **`src/engine/refs.ts` refactor regex `RE` and `Evaluator.parseRef`** — format assumptions leak into
   tabs rename/delete/copy/paste/insert/delete and cross-tab evaluation (name charset `!':` is banned in
   several places). Changing one requires updating: sheet-name sanitising in `model.cleanWorkbook`,
   `finishRename`, `fmtSheet/unq`, and the tests.
3. **`storage/sqlite.ts` mirror/replay logic** — the IndexedDB-export/mirror-clear interplay is subtle;
   a wrong change silently drops the last edits before going offline (the exact bug this system exists
   to prevent).
4. **`SyncManager.save()`/`bootstrap()`** — the revision/dirty/state machine has no server-side session
   concept; an off-by-one in revision bookkeeping either causes spurious conflicts or silent clobbers.
   `keepMine` is the only `force: true` caller.
5. **`server/app.ts` workbook upsert** — single-statement atomic; do not split into select+update
   without re-adding row locking/transactions.
6. **`Store.gate`/`pending` + `ConfirmModal`** — modal swallows all key events globally (capture phase);
   code that adds global key handlers must account for it (Enter/Escape precedence, Tab allowed).
7. **`Store.remap`/`xformAll`/`adjMerges`** — insert/delete columns & rows rewrite all tabs; any new
   structural feature must wire through the same routine or cross-tab refs will desync.
8. **`tab name` normalisation duplicated** in `model.loadWorkbook` (legacy v2 load), `cleanWorkbook`,
   and `finishRename` — keep consistent (lowercase-collision dedupe, `Tab{n}` renumber).
9. **`tsconfig.server.json` include list** — new engine files used by the server must be added there or
   typecheck of the server side silently skips them.
10. **`render.yaml`/env** — `RECOVERY_PEPPER` must never change once accounts exist (breaks recovery codes);
    `JWT_SECRET` rotation signs everyone out (safe but disruptive).
11. **Evaluator indexing with pages** — anything calling `ev.display(si…)`/`numberAt(si…)` must pass the
    position in the flattened `allSheets()` array (`store.flat` for the visible sheet), never a per-page
    tab index. Grid.tsx and Bars.tsx (StatusBar) do; keep it that way.
12. **`cleanWorkbook` accepts two shapes** — every caller (backup open, bootstrap, server PUT, Store
    constructor) relies on both the multi-page and the legacy-migration branches staying lossless;
    the engine tests pin migration, so run them first when touching this function.
13. **Page-local resolution consistency** — the Evaluator's `resolveSheet` (own page first, then first
    match anywhere) and the Store's `resolveSheetFor` used by every tab-name rewrite
    (`xformAll`/`deleteTab`/`deletePage`/`finishRename`) must stay behaviourally identical, or editing on
    one page would rewrite another page's shadowed formulas. `duplicatePage` deliberately renames
    nothing — a twin works because of page-local resolution alone; the `pages` tests pin the twin's
    formula text and independence.

## 11. Observations, risks & open questions (no changes made)

- **Docs drift**: README states 75 tests; the actual suite is 120. README badge and test table could
  mislead. (Trivially fixable when documentation is next touched.)
- **npm audit** items above — `body-parser` DoS fix is a *runtime* security patch worth taking; `zod`
  advisory touches public input parsing. Recommend `npm audit fix` + `npm test` as a follow-up task
  (user decision; not done here).
- **`status.t` in `Evaluator.evalFormula` returns `number`** (declared), but returns `Val|string`
  results from `expr()` — works via checks but is loosely typed; not a bug.
- **Monotonic reading of `version` in SyncManager**: version increments (touch during save) trigger
  `pending` + 200 ms reschedule — paths tested in sync.test.ts; fragile if another save trigger is added
  outside `touch()`.
- **`Grid` memo props `selVer`/`wver` are declared in props but not used inside the memo body** — they
  exist to defeat memoization on selection/width changes (discerned from code; intentional).
- **`App.tsx` conflict banner is the only UX for `conflict`**, but `expired` only surfaces through Root's
  notice + AccountPanel text. `error` status shows only as a status-bar note (SYNC_TEXT) + "Save now" button.
- **`household-ledger.html`** (legacy) uses Google Fonts CDN links (CSP-friendly build doesn't include
  this file; it's served as-is if referenced — not linked from index.html or navigation; confirm intent).
- **No CI/deploy pipeline files** beyond render.yaml; none found in `.github/`.
- **Outstanding analysis gaps** (skimmed, not read line-by-line, judged low-risk static content):
  `src/components/GuideModal.tsx` body (in-app guide text), test bodies after their first ~40% lines
  (server.test.ts lines 100–348, engine.test.ts 80–413, sync.test.ts 60–231, confirm.test.ts 40–336),
  README feature prose vs implementation spot-checks, `public/favicon.svg`, built `dist/` bundle.
- **Roadmap items from README** (not implemented): multiple named ledgers per account; more functions
  (IF/ROUND/COUNT); optional email for recovery codes; account deletion/export; Neon CI integration.

## 12. Environment & commands

```bash
npm run dev        # Vite (5173, /api proxied) + tsx watch server (3001); PGlite auto-DB at .data/dev-db
npm run build      # tsc --noEmit (both projects) && vite build → dist/
npm start          # NODE_ENV=production tsx server/index.ts — serves API + dist/
npm test           # vitest run (node env; PGlite in-memory for server tests)
npm run secrets    # prints fresh JWT_SECRET / RECOVERY_PEPPER values
```

Env vars: `DATABASE_URL` (prod-required), `JWT_SECRET`, `RECOVERY_PEPPER` (both ≥32 chars),
optional `PORT, SESSION_DAYS, TRUST_PROXY, COOKIE_SECURE, PGLITE_DIR, STATIC_DIR, RATE_LIMIT`.

---

*End of PROJECT_CONTEXT.md. Keep this file in sync with the code; when a change lands, update §2/§3/§5/§7/§9
and add the change's context to §10 if it introduces new coupling.*
