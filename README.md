# Horeca POS

Next.js (static export) + Supabase + Dexie (offline) + Tauri desktop app.

## Setup
1. Supabase: create a project, run `supabase/schema.sql` in the SQL editor.
2. Authentication > Users: add your login (email + password). Turn off public sign-ups.
3. Create `.env.local` with `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`).
4. `npm install` then `npm run dev` (http://localhost:3000).
5. Sign in once while online. The first sync loads the four accounts (Cash, Bank, Easypaisa, JazzCash).

## How offline works
- Screens read and write the local IndexedDB database only.
- Every change is queued in an outbox and pushed to Supabase on: app start, every hour, "Sync now", and when the connection returns.
- After pushing, the app pulls rows changed on the server.
- Stock is an append-only ledger (stock_movements); the server keeps products.stock_qty up to date.

## Deploy
Push to GitHub, import in Vercel, and add the two Supabase env vars. `npm run build`
outputs a static site to `out/`.

## Windows desktop app
Install Node.js, Rust with the MSVC toolchain, Microsoft C++ Build Tools, and
the WebView2 Runtime. Then, from Windows PowerShell in this project:

1. Create `.env.local` with the Supabase URL and publishable/anon key. These
   public frontend values are embedded in the static app at build time.
2. Run `npm install`.
3. Run `npm run desktop:dev` to launch the app in its Tauri window.
4. Run `npm run desktop:build` to create the Windows NSIS installer `.exe`.

The installer is written under
`src-tauri/target/release/bundle/nsis/`. The desktop app keeps its UI and local
database available offline; Supabase sign-in and cloud sync require internet.

## Update notes
- Run `supabase/migration_sales_returns_purchases.sql` in the Supabase SQL editor before using Sales (cancel), Returns, Suppliers and Purchases.
- Run `supabase/subscription.sql` once to create the subscription switch used by the 3-day sync rule and the future super-admin app.

## Users, customers, employees, ledgers
1. Run `supabase/migration_users_employees_ledgers.sql` in the Supabase SQL editor (after the earlier SQL files).
   Everyone who can already sign in becomes an administrator, so nobody is locked out.
2. Deploy the user-management function: see `supabase/functions/admin-users/README.md`.
3. Open Users (administrators only) to add people and choose what each can open and do.
