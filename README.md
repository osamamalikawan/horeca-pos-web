# Horeca POS

Next.js (static export) + Supabase + Dexie (offline) — Tauri shell comes next.

## Setup
1. Supabase: create a project, run `supabase/schema.sql` in the SQL editor.
2. Authentication > Users: add your login (email + password). Turn off public sign-ups.
3. `cp .env.local.example .env.local` and fill in the project URL and anon key.
4. `npm install` then `npm run dev` (http://localhost:3000).
5. Sign in once while online. The first sync loads the four accounts (Cash, Bank, Easypaisa, JazzCash).

## How offline works
- Screens read and write the local IndexedDB database only.
- Every change is queued in an outbox and pushed to Supabase on: app start, every hour, "Sync now", and when the connection returns.
- After pushing, the app pulls rows changed on the server.
- Stock is an append-only ledger (stock_movements); the server keeps products.stock_qty up to date.

## Deploy
Push to GitHub, import in Vercel, add the two env vars. `npm run build` outputs a static site to `out/`, which Tauri will bundle later.

## Update notes
- Run `supabase/migration_sales_returns_purchases.sql` in the Supabase SQL editor before using Sales (cancel), Returns, Suppliers and Purchases.
- Run `supabase/subscription.sql` once to create the subscription switch used by the 3-day sync rule and the future super-admin app.

## Users, customers, employees, ledgers
1. Run `supabase/migration_users_employees_ledgers.sql` in the Supabase SQL editor (after the earlier SQL files).
   Everyone who can already sign in becomes an administrator, so nobody is locked out.
2. Deploy the user-management function: see `supabase/functions/admin-users/README.md`.
3. Open Users (administrators only) to add people and choose what each can open and do.

## Shortcut keys
- POS: `F2` scan box, `Ctrl+Enter` complete sale, `Ctrl+Shift+Enter` complete and print.
- Several invoices at once: `Alt+N` new invoice, `Alt+1` to `Alt+9` switch, `Alt+W` close. They stay open when you visit other pages.
- Pages: `Alt+` the letter shown beside each menu item (for example `Alt+S` Sales, `Alt+I` Products). `Alt+K` or `Ctrl+K` opens a jump list.
