# admin-users function

Lets an administrator create, edit, disable, delete users and reset passwords from the POS Users page.
It runs on Supabase so the service-role key never reaches the app.

1. Install the Supabase CLI and log in: `supabase login`
2. From the project folder: `supabase link --project-ref YOUR-PROJECT-REF`
3. Deploy: `supabase functions deploy admin-users`

No secrets need to be set: Supabase gives the function its own URL and keys.
Only users whose profile role is `admin` can use it.
